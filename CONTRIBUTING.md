# Contributing

## Development

Requirements:

- Visual Studio Code
- Node.js 20+
- npm
- PowerShell

```powershell
cd .\extension
npm install
npm run compile
```

Press `F5` to launch the Extension Development Host.

## Build

```powershell
.\scripts\build-vsix.ps1 `
  -TargetRoot ".\extension" `
  -OutputFolder ".\artifacts"
```

Do not commit API keys, private documents, logs, local settings, `node_modules`, ZIP files, or VSIX files.

Only contribute public and redistributable knowledge.
