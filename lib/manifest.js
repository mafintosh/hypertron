const fs = require('fs')
const hyperdrive = require('hyperdrive')
const { parse, resolve } = require('url')

module.exports = class Manifest {
  constructor (drives, url) {
    const p = parse(url)

    this.drives = drives
    this.url = url
    this.isHyperdrive = p.protocol === 'hyper:'
    this.drive = this.isHyperdrive ? drives.checkout(p.hostname) : fs
    this.path = p.pathname || '/'
    this.data = null
    this.downloads = new Set()
  }

  async preload () {
    await this.load()

    if (!this.data.trace) return { preloaded: 0, trace: {} }

    const trace = {}
    const all = []

    for (const key of Object.keys(this.data.trace)) {
      all.push(new Promise((resolve, reject) => {
        this.drive.readFile(this.data.trace[key], (err, buf) => {
          if (err) return reject(err)
          trace[key] = buf.toString()
          resolve()
        })
      }))
    }

    await Promise.allSettled(all)
    return { preloaded: all.length, trace }
  }

  async main (opts = {}) {
    const drive = this.drive
    const u = this.url

    try {
      await this.load()

      if (this.data.main) {
        const type = /\.html$/.test(this.data.main) ? 'html' : 'js'
        return done(type, this.data.main)
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }

    const hasIndexHTML = await new Promise(resolve => {
      this.drive.stat(this.path + '/index.html', function (err) {
        resolve(!err)
      })
    })

    if (hasIndexHTML) return done('html', 'index.html')

    const hasIndexJS = await new Promise(resolve => {
      this.drive.stat(this.path + '/index.js', function (err) {
        resolve(!err)
      })
    })

    if (hasIndexJS) return done('js', 'index.js')

    throw new Error('No entry point found (data.main)')

    async function done (type, filename) {
      const url = resolve(u + '/', filename).replace(/\/\//g, '')
      if (opts.preload) {
        const { pathname } = parse(url)
        await new Promise((resolve, reject) => {
          drive.readFile(pathname, (err) => {
            if (err) return reject(err)
            resolve()
          })
        })
      }
      return { type, url }
    }
  }

  async download () {
    if (!this.isHyperdrive) return
    const data = await this.load()

    return new Promise((resolve, reject) => {
      const d = this.drive.download(this.path, (err) => {
        this.downloads.delete(d)
        if (err) reject(err)
        else resolve()
      })

      this.downloads.add(d)
    })
  }

  async load () {
    if (this.data) return this.data

    await new Promise((resolve, reject) => {
      this.drive.readFile(this.path + '/hyperspace.json', (err, buf) => {
        if (err) return reject(err)

        try {
          this.data = JSON.parse(buf)
        } catch (err) {
          return reject(err)
        }
        resolve()
      })
    })

    return this.data
  }

  close () {
    if (this.isHyperdrive) {
      for (const d of this.downloads) d.destroy()
      this.drives.checkin(this.drive)
    }
  }

  static async load (drives, url) {
    const m = new this(drives, url)
    await m.load()
    m.close()
    return m.data
  }
}
