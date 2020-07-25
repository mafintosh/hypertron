const { BrowserWindow, app, protocol, Menu } = require('electron')
const path = require('path')
const hyperspace = require('hyperspace')
const Manifest = require('./lib/manifest')
const Drives = require('./lib/drive-cache')


// To disable the dev tools nagging
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = true

const TEST_APP = 'file://' + path.join(__dirname, 'app')
const SPLASH = 'file://' + path.join(__dirname, 'splash.html')
const DEFAULT_APP = 'file://' + path.join(__dirname, 'default.html')
const PRELOAD = path.join(__dirname, 'lib/preload.js')

const SPLASH_CONF = { frame: false, width: 430, height: 250, backgroundColor: '#34495E' }

const minimist = require('minimist')
const argv = minimist(process.argv, {
  alias: {
    devtools: 'd'
  },
  boolean: ['devtools', 'splash'],
  default: {
    splash: true
  }
})

let appUrl = argv._[2] || TEST_APP

if (appUrl.indexOf('://') === -1) {
  appUrl = 'file://' + path.resolve(appUrl)
}

let win, server

protocol.registerSchemesAsPrivileged([
  { scheme: 'hyper', privileges: { standard: true, secure: true, bypassCSP: true, corsEnabled: true, supportFetchAPI: true, allowServiceWorkers: true }},
  { scheme: 'file', privileges: { standard: true, secure: true, bypassCSP: true, corsEnabled: true, supportFetchAPI: true, allowServiceWorkers: true }}
])

app.name = 'Hyperspace'
app.allowRendererProcessReuse = false
app.on('ready', start)
app.on('will-quit', stop)

async function start () {
  let client = new hyperspace.Client()

  try {
    await client.ready()
  } catch (err) {
    server = new hyperspace.Server()
    await server.ready()
    client = new hyperspace.Client()
    await client.ready()
  }

  require('./lib/protocol')(protocol)
  process.launch = launch

  launch(appUrl, { splash: argv.splash, devtools: argv.devtools })
}

function launch (app, conf = {}, preload) {
  const type = typeof app === 'string' ? 'html' : app.type
  const url = typeof app === 'string' ? app : app.url

  conf = { ...conf }

  const isSplash = conf.splash
  const windowConf = isSplash ? SPLASH_CONF : conf.window

  const win = new BrowserWindow({
    ...windowConf,
    webPreferences: {
      preload: PRELOAD,
      nodeIntegration: true,
      nodeIntegrationInWorker: true,
      nodeIntegrationInSubFrames: false,
      enableRemoteModule: true
    }
  })

  win.hyperspacePreload = preload

  win.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  win.webContents.on('context-menu', (event, params) => {
    const { editFlags } = params
    const hasText = params.selectionText.trim().length > 0
    const can = type => editFlags[`can${type}`] && hasText

    const menuTpl = [{
      type: 'separator'
    }, {
      id: 'cut',
      label: 'Cut',
      // Needed because of macOS limitation:
      // https://github.com/electron/electron/issues/5860
      role: can('Cut') ? 'cut' : '',
      enabled: can('Cut'),
      visible: params.isEditable
    }, {
      id: 'copy',
      label: 'Copy',
      role: can('Copy') ? 'copy' : '',
      enabled: can('Copy'),
      visible: params.isEditable || hasText
    }, {
      id: 'paste',
      label: 'Paste',
      role: editFlags.canPaste ? 'paste' : '',
      enabled: editFlags.canPaste,
      visible: params.isEditable
    }, {
      type: 'separator'
    }]

    if (conf.devtools) {
      menuTpl.push({
        type: 'separator'
      }, {
        id: 'inspect',
        label: 'Inspect Element',
        click () {
          win.inspectElement(params.x, params.y)

          if (win.webContents.isDevToolsOpened()) {
            win.webContents.devToolsWebContents.focus()
          }
        }
      }, {
        type: 'separator'
      })
    }

    const menu = Menu.buildFromTemplate(menuTpl)
    menu.popup(win)
  })

  if (conf.devtools) {
    win.webContents.on('did-finish-load', () => {
      win.webContents.openDevTools({ mode: 'detach' })
    })
  }

  conf.splash = false
  conf.app = url

  win.webContents.loadURL((isSplash ? SPLASH : type === 'js' ? DEFAULT_APP : url) + '#' + JSON.stringify(conf))
}

async function stop (e) {
  if (server) {
    e.preventDefault()
    if (server) {
      console.log('Waiting for hyperspace server to close...')
      await server.close()
      console.log('hyperspace server closed.')
      server = null
    }
    app.quit()
  }
}
