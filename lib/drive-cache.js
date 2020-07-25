module.exports = class DriveCache {
  constructor ({ corestore, networker }) {
    this.corestore = corestore
    this.networker = networker
    this.byKey = new Map()
    this.byDrive = new Map()
  }

  checkout (key) {
    if (!Buffer.isBuffer(key)) key = Buffer.from(key, 'hex')

    const id = key.toString('hex')
    const a = this.byKey.get(id)

    if (a) {
      a.refs++
      return a.drive
    }

    a = { id, refs: 1, drive: hyperdrive(this.corestore(), key) }
    a.drive.ready(() => {
      this.network.configure(a.drive.discoveryKey, {
        lookup: true,
        announce: false
      })
    })

    this.byDrive.set(a.drive, a)
    this.byKey.set(id, a)

    return a.drive
  }

  checkin (drive) {
    const a = this.byDrive.get(drive)
    if (!a) throw new Error('Bad drive')
    if (--a.refs) return false

    this.byDrive.delete(a.drive)
    this.byKey.delete(a.id)

    a.drive.close(() => {
      network.configure(a.drive.discoveryKey, {
        lookup: false,
        announce: false
      })
    })

    return true
  }
}
