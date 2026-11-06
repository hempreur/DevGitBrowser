# Native MSHTML child window hosted INSIDE DevGitBrowser's Windows client area.
# The Node/Electron parent controls its lifetime through a UTF-8 line protocol.
# This helper must never be launched for unapproved/untrusted sites automatically.
param(
  [string]$ParentHandle = '',
  [string]$InitialUrl = '',
  [int]$X = 0,
  [int]$Y = 118,
  [int]$Width = 900,
  [int]$Height = 650,
  [switch]$CompileOnly
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$source = @'
using System;
using System.IO;
using System.Text;
using System.Drawing;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.Threading;

public sealed class DevGitLegacyHost : Form {
    const int GWL_STYLE = -16;
    const long WS_CHILD = 0x40000000L;
    const long WS_POPUP = 0x80000000L;
    const int SWP_NOZORDER = 0x0004;
    const int SWP_FRAMECHANGED = 0x0020;
    const int SW_HIDE = 0;
    const int SW_SHOW = 5;

    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr GetParent(IntPtr child);
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);
    [DllImport("user32.dll", SetLastError=true)] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, int flags);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int command);

    readonly WebBrowser browser;
    readonly IntPtr parent;
    readonly Uri initialOrigin;
    static readonly object writeLock = new object();
    static string Encode(string value) {return Convert.ToBase64String(Encoding.UTF8.GetBytes(value ?? ""));}
    static string Decode(string value) {return Encoding.UTF8.GetString(Convert.FromBase64String(value ?? ""));}
    static void Emit(string name, string value) {
      lock (writeLock) { Console.Out.WriteLine(name + "\t" + Encode(value)); Console.Out.Flush(); }
    }
    static bool SafeAddress(string text) {
      Uri target; if (!Uri.TryCreate(text, UriKind.Absolute, out target))return false;
      return (target.Scheme == Uri.UriSchemeHttps || target.Scheme == Uri.UriSchemeHttp) &&
        string.IsNullOrEmpty(target.UserInfo) && !string.IsNullOrEmpty(target.Host);
    }
    public DevGitLegacyHost(IntPtr parentHwnd, string address, int x,int y,int w,int h) {
      this.parent=parentHwnd;
      this.initialOrigin=new Uri(address);
      FormBorderStyle=FormBorderStyle.None;
      ShowInTaskbar=false;
      StartPosition=FormStartPosition.Manual;
      Bounds=new Rectangle(x,y,Math.Max(1,w),Math.Max(1,h));
      BackColor=Color.White;
      browser=new WebBrowser();
      browser.Dock=DockStyle.Fill;
      browser.AllowWebBrowserDrop=false;
      browser.ScriptErrorsSuppressed=true;
      browser.IsWebBrowserContextMenuEnabled=false;
      browser.NewWindow+=(sender,e)=>{e.Cancel=true;}; // deny unfiltered IE pop-ups
      browser.WebBrowserShortcutsEnabled=true;
      browser.Navigating+=(sender,e)=>{
        Uri u=e.Url;
        if(u!=null && u.AbsoluteUri!="about:blank"){
          if(!SafeAddress(u.AbsoluteUri)){e.Cancel=true;return;}
          // Switching to another site exits MSHTML; normal Chromium handles external links.
          if(u.Host!=initialOrigin.Host || u.Port!=initialOrigin.Port || u.Scheme!=initialOrigin.Scheme){
            e.Cancel=true;
            // An embedded iframe cannot force the top-level tab to leave its site.
            if(String.IsNullOrEmpty(e.TargetFrameName))Emit("EXTERNAL",u.AbsoluteUri);
          }
        }
      };
      browser.Navigated+=(sender,e)=>{try{if(browser.Url!=null && SafeAddress(browser.Url.AbsoluteUri))Emit("URL", browser.Url.AbsoluteUri);}catch{}};
      browser.DocumentTitleChanged+=(sender,e)=>{try{Emit("TITLE",browser.DocumentTitle);}catch{}};
      browser.DocumentCompleted+=(sender,e)=>{try{Emit("READYURL",browser.Url==null?"":browser.Url.AbsoluteUri);}catch{}};
      Controls.Add(browser);
      Shown+=(sender,e)=>{
        // This is a Windows child HWND, not a separate top-level application window.
        SetParent(Handle,parent);
        if (GetParent(Handle)!=parent) {
          Emit("ERROR","Impossible d'intégrer le moteur IE dans l'onglet Windows.");Close();return;
        }
        long style=GetWindowLongPtr(Handle,GWL_STYLE).ToInt64();
        long newStyle=(style & ~WS_POPUP) | WS_CHILD;
        SetWindowLongPtr(Handle,GWL_STYLE,new IntPtr(newStyle));
        if(!SetWindowPos(Handle,IntPtr.Zero,x,y,Math.Max(1,w),Math.Max(1,h),SWP_FRAMECHANGED|SWP_NOZORDER)){
          Emit("ERROR","Le contrôle IE ne peut pas être positionné dans l'onglet Windows.");Close();return;
        }
        Emit("READY","");
        if(SafeAddress(address))browser.Navigate(address); else Emit("ERROR","Adresse HTTP(S) invalide.");
      };
      FormClosed+=(sender,e)=>Emit("CLOSED","");
    }
    void ApplyCommand(string line) {
      if(IsDisposed || !IsHandleCreated) return;
      string[] parts=line.Split(new char[]{'\t'},2);
      string code=parts[0]; string value=parts.Length>1 ? Decode(parts[1]) : "";
      try {
        if(code=="NAV" && SafeAddress(value))browser.Navigate(value);
        else if(code=="RELOAD")browser.Refresh(WebBrowserRefreshOption.Completely);
        else if(code=="BACK" && browser.CanGoBack)browser.GoBack();
        else if(code=="FORWARD" && browser.CanGoForward)browser.GoForward();
        else if(code=="PRINT")browser.ShowPrintDialog();
        else if(code=="BOUNDS") {
          var nums=value.Split(',');
          if(nums.Length==4) {
            int x=int.Parse(nums[0]),y=int.Parse(nums[1]),w=int.Parse(nums[2]),h=int.Parse(nums[3]);
            if(w>0 && h>0 && w<20000 && h<20000)SetWindowPos(Handle,IntPtr.Zero,x,y,w,h,SWP_NOZORDER);
          }
        }
        else if(code=="SHOW")ShowWindow(Handle,SW_SHOW);
        else if(code=="HIDE")ShowWindow(Handle,SW_HIDE);
        else if(code=="QUIT")Close();
      }catch(Exception ex){Emit("ERROR",ex.Message);}
    }
    public static void Run(string handleText,string url,int x,int y,int w,int h) {
      if(!SafeAddress(url)) {Emit("ERROR","Adresse rejetée.");return;}
      ulong raw; if(!ulong.TryParse(handleText,out raw)||raw==0){Emit("ERROR","Fenêtre parent invalide.");return;}
      var form=new DevGitLegacyHost(new IntPtr(unchecked((long)raw)),url,x,y,w,h);
      var reader=new Thread(()=>{
        try {string line;while((line=Console.ReadLine())!=null){
          if(form.IsDisposed)break;
          string cmd=line;
          try{form.BeginInvoke((Action)(()=>form.ApplyCommand(cmd)));}catch{break;}
        }}catch(Exception e){Emit("ERROR",e.Message);}
        try{if(!form.IsDisposed)form.BeginInvoke((Action)(()=>form.Close()));}catch{}
      });
      reader.IsBackground=true;reader.Start();
      Application.Run(form);
      form.Dispose();
    }
}
'@
try {
  Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.Windows.Forms','System.Drawing'
  if($CompileOnly){Write-Output 'MSHTML WinForms helper compiled';exit 0}
  [DevGitLegacyHost]::Run($ParentHandle,$InitialUrl,$X,$Y,$Width,$Height)
} catch {
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($_.Exception.Message))
  [Console]::Out.WriteLine("ERROR`t$encoded")
  exit 1
}
