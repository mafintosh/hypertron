#!/usr/bin/env node

const { spawn } = require('child_process')
const path = require('path')

const child = spawn(require('electron'), [path.join(__dirname, 'electron.js'), ...process.argv.slice(2)], {
  stdio: 'inherit'
}).on('exit', code => process.exit(code))

process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
