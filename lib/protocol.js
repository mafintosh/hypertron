const { Client } = require('hyperspace')
const hyperdrive = require('hyperdrive')
const mime = require('mime')
const resolve = require('resolve')
const { parse } = require('url')
const path = require('path')
const fs = require('fs')

module.exports = function (protocol) {
  const { network, corestore } = new Client()
  const active = new Map()

  function getDrive (corestore, key) {
    if (!key || !/^[a-f0-9]{64}$/i.test(key)) return null

    let a = active.get(key)
    if (a) {
      a.refs++
      return a
    }

    a = { refs: 1, drive: hyperdrive(corestore(), Buffer.from(key, 'hex')), done }
    a.drive.ready(() => {
      network.configure(a.drive.discoveryKey, {
        lookup: true,
        announce: false
      })
    })
    active.set(a)

    return a

    function done () {
      if (--a.refs) return

      active.delete(key)
      a.drive.close(() => {
        network.configure(a.drive.discoveryKey, {
          lookup: false,
          announce: false
        })
      })
    }
  }

  protocol.registerStreamProtocol('cjs', (request, callback) => {
    const { query } = parse(request.url, true)
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Allow-CSP-From': '*',
      'Content-Type': 'text/plain'
    }

    const opts = { basedir: path.dirname(query.filename) }
    const d = getDrive(corestore, query.key)

    const drive = d && d.drive
    let { createReadStream } = fs

    if (drive) {
      opts.isFile = (name, cb) => {
        drive.stat(name, (err, st) => {
          if (err && err.code === 'ENOENT') return cb(null, false)
          cb(err, st ? st.isFile() : false)
        })
      }

      opts.isDirectory = (name, cb) => {
        drive.stat(name, (err, st) => {
          if (err && err.code === 'ENOENT') return cb(null, false)
          cb(err, st ? st.isDirectory() : false)
        })
      }

      opts.readFile = (name, cb) => {
        drive.readFile(name, cb)
      }

      opts.realpath = (name, cb) => cb(null, name)

      createReadStream = drive.createReadStream.bind(drive)
    }

    resolve(query.name, opts, function (err, filename) {
      if (err) {
        close()
        return callback({
          statusCode: 404,
          headers,
          data: null
        })
      }

      headers['X-Filename'] = filename
      headers['X-Dirname'] = path.dirname(filename)

      if (query.empty) {
        close()
        callback({
          statusCode: 200,
          headers,
          data: null
        })
        return
      }

      callback({
        statusCode: 200,
        headers,
        data: new WhackAMoleStream(createReadStream(filename), close)
      })

      function close () {
        if (d) d.done()
      }
    })
  })

  protocol.registerStreamProtocol('hyper', (request, callback) => {
    const u = request.url.replace('hyper://', '').split('?')[0]

    const i = u.indexOf('/')
    const key = i === -1 ? u : u.slice(0, i)
    const name = u.slice(key.length) || '/'

    let statusCode = 200
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Allow-CSP-From': '*'
    }

    const d = getDrive(corestore, key)
    if (!d) return done(null)

    const { drive } = d

    drive.ready(function () {
      network.configure(drive.discoveryKey, {
        lookup: true,
        announce: false
      })
    })

    drive.stat(name, function (err, entry) {
      if (err) {
        statusCode = 404
        return done()
      }

      const t = mime.getType(name)
      if (t) headers['Content-Type'] = t

      // handle range
      headers['Accept-Ranges'] = 'bytes'
      let length
      let range = request.headers.Range || request.headers.range
      if (range) range = parseRange(entry.size, range)
      if (range && range.type === 'bytes') {
        range = range[0] // only handle first range given
        statusCode = 206
        length = (range.end - range.start + 1)
        headers['Content-Length'] = '' + length
        headers['Content-Range'] = 'bytes ' + range.start + '-' + range.end + '/' + entry.size
        return done(drive.createReadStream(name, { start: range.start, end: range.end }))
      }

      length = entry.size
      headers['Content-Length'] = '' + length
      done(drive.createReadStream(name))
    })

    function done (stream) {
      if (!stream) close()
      callback({
        statusCode,
        headers,
        data: stream && new WhackAMoleStream(stream, close)
      })

      function close () {
        if (d) d.done()
      }
    }
  })
}

class WhackAMoleStream {
  constructor (stream, ondone) {
    this.onreadable = noop
    this.ended = false
    this.stream = stream
    this.needsDeferredReadable = false
    this.ondone = ondone
    this.readableOnce = false

    stream.on('end', () => {
      this.ended = true
    })

    stream.on('readable', () => {
      if (this.needsDeferredReadable) {
        setImmediate(this.onreadable)
        this.needsDeferredReadable = false
        return
      }

      this.readableOnce = true
      this.onreadable()
    })
  }

  read (...args) {
    const buf = this.stream.read(...args)
    this.needsDeferredReadable = buf === null
    return buf
  }

  on (name, fn) {
    if (name === 'readable') {
      this.onreadable = fn
      if (this.readableOnce) fn()
      return this.stream.on('readable', noop) // readable has sideeffects
    }

    return this.stream.on(name, fn)
  }

  destroy () {
    this.stream.on('error', noop)
    this.stream.destroy()
    if (this.ondone) this.ondone()
  }

  removeListener (name, fn) {
    this.stream.removeListener(name, fn)

    if (name === 'readable') {
      this.onreadable = noop
      this.stream.removeListener('readable', noop)
    }

    if (name === 'end') {
      if (!this.ended) this.destroy()
      else if (this.ondone) this.ondone()
    }
  }
}

function noop () {}
