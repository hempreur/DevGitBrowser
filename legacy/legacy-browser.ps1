# This explicitly user-invoked legacy window hosts the Windows MSHTML/WebBrowser
# control for compatibility with old sites. It is NOT suitable for modern services.
param([Parameter(Mandatory=$true)][string] $Url)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$uri = $null
if (-not [System.Uri]::TryCreate($Url,[System.UriKind]::Absolute,[ref]$uri) -or $uri.Scheme -notin @('http','https')) { exit 2 }
$form = New-Object System.Windows.Forms.Form
$form.Text = 'DevGitBrowser — Legacy IE/MSHTML (site ancien uniquement)'
$form.Width = 1140; $form.Height = 800; $form.StartPosition = 'CenterScreen'
$form.BackColor = [System.Drawing.Color]::FromArgb(22,22,45)
$top = New-Object System.Windows.Forms.Panel
$top.Dock = 'Top'; $top.Height = 70
$notice = New-Object System.Windows.Forms.Label
$notice.AutoSize = $false; $notice.Height = 28; $notice.Dock = 'Top'
$notice.Text = 'MOTEUR HISTORIQUE — réservé aux sites anciens connus. Ne saisissez pas de données sensibles.'
$notice.ForeColor = [System.Drawing.Color]::White
$notice.BackColor = [System.Drawing.Color]::FromArgb(120,52,65)
$input = New-Object System.Windows.Forms.TextBox
$input.Dock = 'Fill';$input.Text=$Url
$go = New-Object System.Windows.Forms.Button
$go.Dock = 'Right';$go.Width=95;$go.Text='Ouvrir'
$address = New-Object System.Windows.Forms.Panel
$address.Dock='Fill';$address.Controls.Add($input);$address.Controls.Add($go)
$top.Controls.Add($address);$top.Controls.Add($notice)
$web = New-Object System.Windows.Forms.WebBrowser
$web.Dock='Fill';$web.ScriptErrorsSuppressed=$true; $web.IsWebBrowserContextMenuEnabled=$false
$web.WebBrowserShortcutsEnabled=$true
$go.Add_Click({ try { $web.Navigate($input.Text) } catch { [System.Windows.Forms.MessageBox]::Show('Adresse invalide.') | Out-Null } })
$input.Add_KeyDown({ if($_.KeyCode -eq [System.Windows.Forms.Keys]::Enter){$go.PerformClick();$_.SuppressKeyPress=$true} })
$web.Add_Navigated({$input.Text = $web.Url.AbsoluteUri })
$form.Controls.Add($web);$form.Controls.Add($top)
$form.Add_Shown({ $web.Navigate($Url) })
[System.Windows.Forms.Application]::Run($form)
$web.Dispose();$form.Dispose()
