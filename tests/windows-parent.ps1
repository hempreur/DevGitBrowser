# Minimal native HWND parent for verifying real MSHTML child attachment on a Windows runner.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$form=New-Object System.Windows.Forms.Form
$form.Text='DevGitBrowser MSHTML smoke parent'
$form.StartPosition='Manual'
$form.Location=New-Object System.Drawing.Point(20,20)
$form.Size=New-Object System.Drawing.Size(920,720)
$form.ShowInTaskbar=$false
$form.Show()
[Console]::Out.WriteLine('PARENT'+[char]9+$form.Handle.ToInt64())
[Console]::Out.Flush()
[System.Windows.Forms.Application]::Run($form)
