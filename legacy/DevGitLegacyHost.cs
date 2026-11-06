using System;
using System.IO;
using System.Text;
using System.Drawing;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32;

public sealed class DevGitLegacyHost : Form {
    const int GWL_STYLE = -16;
    const long WS_CHILD = 0x40000000L;
    const long WS_POPUP = 0x80000000L;
    const int SWP_NOACTIVATE = 0x0010;
    const int SWP_SHOWWINDOW = 0x0040;
    const int SWP_FRAMECHANGED = 0x0020;
    static readonly IntPtr HWND_TOP = IntPtr.Zero;
    const int SW_HIDE = 0;
    const int SW_SHOW = 5;

    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr GetParent(IntPtr child);
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);
    [DllImport("user32.dll", SetLastError=true)] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, int flags);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int command);

    // This dedicated executable alone has an IE11 emulation key; NEVER set powershell.exe globally.
    static void ConfigureEmulation() {
      using (RegistryKey key=Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Internet Explorer\Main\FeatureControl\FEATURE_BROWSER_EMULATION")) {
        if(key==null)throw new InvalidOperationException("Impossible de configurer IE11 dans le profil Windows.");
        key.SetValue("DevGitLegacyHost.exe", 11001, RegistryValueKind.DWord);
      }
    }
    static int ReadDocumentMode(WebBrowser control) {
      try {
        if(control.Document==null)return 0;
        var obj=control.Document.InvokeScript("eval",new object[]{"document.documentMode || 0"});
        return Convert.ToInt32(obj);
      }catch{return 0;}
    }
    [STAThread]
    public static int Main(string[] args) {
      try {
        ConfigureEmulation();
        var options=new System.Collections.Generic.Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
        for(int i=0;i+1<args.Length;i+=2)options[args[i]]=args[i+1];
        string parent,url;
        if(!options.TryGetValue("-ParentHandle",out parent) || !options.TryGetValue("-InitialUrl",out url))throw new ArgumentException("Paramètres de fenêtre IE manquants.");
        int x=ParseDimension(options,"-X",0),y=ParseDimension(options,"-Y",118),w=ParseDimension(options,"-Width",900),h=ParseDimension(options,"-Height",650);
        Application.EnableVisualStyles();
        Run(parent,url,x,y,w,h);return 0;
      }catch(Exception ex){Emit("ERROR",ex.Message);return 1;}
    }
    static int ParseDimension(System.Collections.Generic.Dictionary<string,string> options,string key,int fallback){
      string text;int n;
      return options.TryGetValue(key,out text) && int.TryParse(text,out n)?n:fallback;
    }

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
      browser.DocumentCompleted+=(sender,e)=>{
        try {
          // Never claim the engine is ready until the top-level MSHTML document exists.
          if(browser.Url!=null && e.Url!=null && browser.Url==e.Url &&
             browser.ReadyState==WebBrowserReadyState.Complete && browser.Document!=null && SafeAddress(browser.Url.AbsoluteUri)) {
            int mode=ReadDocumentMode(browser);
            Emit("MODE", mode.ToString());
            if(mode<11){Emit("INCOMPATIBLE", "Le contrôle Windows utilise IE"+mode+" au lieu du mode IE11. Retour au moteur moderne.");return;}
            // WebRTC webcam/video capture is unavailable in MSHTML even on IE11.
            // Do not mark a video-centric web app as successfully rendered in IE.
            if (browser.Document.GetElementsByTagName("video").Count>0 && browser.Url.Scheme=="https") {
              Emit("INCOMPATIBLE", "Cette page utilise de la vidéo HTML5. Le moteur IE11 ne prend pas en charge les webcams WebRTC. Retour à Chromium.");return;
            }
            Emit("READY",browser.Url.AbsoluteUri);
            Emit("READYURL",browser.Url.AbsoluteUri);
          }
        } catch(Exception ex) {Emit("ERROR", "Chargement IE : " + ex.Message);}
      };
      Controls.Add(browser);
      Shown+=(sender,e)=>{
        // This is a Windows child HWND, not a separate top-level application window.
        // WS_CHILD must be set before SetParent (Microsoft Win32 contract).
        long style=GetWindowLongPtr(Handle,GWL_STYLE).ToInt64();
        long newStyle=(style & ~WS_POPUP) | WS_CHILD;
        SetWindowLongPtr(Handle,GWL_STYLE,new IntPtr(newStyle));
        SetParent(Handle,parent);
        if (GetParent(Handle)!=parent) {
          Emit("ERROR","Impossible d'intégrer le moteur IE dans l'onglet Windows. Erreur Windows : " + Marshal.GetLastWin32Error());Close();return;
        }
        // Critical: keep the native child ABOVE Chromium's native window, not just reparented behind it.
        if(!SetWindowPos(Handle,HWND_TOP,x,y,Math.Max(1,w),Math.Max(1,h),SWP_FRAMECHANGED|SWP_SHOWWINDOW|SWP_NOACTIVATE)){
          Emit("ERROR","Le contrôle IE ne peut pas être affiché dans l'onglet Windows. Erreur : " + Marshal.GetLastWin32Error());Close();return;
        }
        Emit("ATTACHED","");
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
            if(w>0 && h>0 && w<20000 && h<20000)SetWindowPos(Handle,HWND_TOP,x,y,w,h,SWP_NOACTIVATE);
          }
        }
        else if(code=="SHOW"){ShowWindow(Handle,SW_SHOW);SetWindowPos(Handle,HWND_TOP,Left,Top,Width,Height,SWP_NOACTIVATE|SWP_SHOWWINDOW);}
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
