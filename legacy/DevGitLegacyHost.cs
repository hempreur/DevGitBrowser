using System;
using System.IO;
using System.Text;
using System.Drawing;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32;

public sealed class DevGitLegacyHost : Form {
    const int GWLP_HWNDPARENT = -8;
    const uint GW_OWNER = 4;
    const int SWP_NOACTIVATE = 0x0010;
    const int SWP_SHOWWINDOW = 0x0040;
    const int SWP_FRAMECHANGED = 0x0020;
    static readonly IntPtr HWND_TOP = IntPtr.Zero;
    const int SW_HIDE = 0;
    const int SW_SHOW = 5;

    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll", SetLastError=true)] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out WinRect bounds);
    [StructLayout(LayoutKind.Sequential)] struct WinRect {public int Left,Top,Right,Bottom;}
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

    readonly LegacyWebBrowser browser;
    readonly System.Collections.Generic.List<LegacyPopupWindow> popups=new System.Collections.Generic.List<LegacyPopupWindow>();
    readonly System.Collections.Generic.Queue<DateTime> popupTimes=new System.Collections.Generic.Queue<DateTime>();
    BrowserPopupSink popupSink;
    AxHost.ConnectionPointCookie popupCookie;
    readonly IntPtr parent;
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
      FormBorderStyle=FormBorderStyle.None;
      ShowInTaskbar=false;
      StartPosition=FormStartPosition.Manual;
      Bounds=new Rectangle(x,y,Math.Max(1,w),Math.Max(1,h));
      BackColor=Color.White;
      browser=new LegacyWebBrowser();
      browser.Dock=DockStyle.Fill;
      browser.AllowWebBrowserDrop=false;
      browser.ScriptErrorsSuppressed=true;
      browser.IsWebBrowserContextMenuEnabled=false;
      browser.WebBrowserShortcutsEnabled=true;
      browser.Navigating+=(sender,e)=>{
        Uri u=e.Url;
        if(u!=null && u.AbsoluteUri!="about:blank"){
          if(!SafeAddress(u.AbsoluteUri)){e.Cancel=true;return;}
          // IE Tab-style session: HTTP(S) links stay in MSHTML after the site owner opted in.
          // Legacy trust is NOT persisted for sites reached through links.
          if(IsModernVideoHost(u.Host)){e.Cancel=true; if(String.IsNullOrEmpty(e.TargetFrameName))Emit("EXTERNAL",u.AbsoluteUri);}
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
            WinRect rect;
            if(!IsWindowVisible(Handle)||!GetWindowRect(Handle,out rect)||rect.Right<=rect.Left||rect.Bottom<=rect.Top){
              Emit("ERROR","Le rendu IE n’a pas de fenêtre visible; retour à Chromium.");return;
            }
            Emit("READY",browser.Url.AbsoluteUri);
            Emit("DISPLAY",browser.Url.AbsoluteUri);
            Emit("READYURL",browser.Url.AbsoluteUri);
          }
        } catch(Exception ex) {Emit("ERROR", "Chargement IE : " + ex.Message);}
      };
      Controls.Add(browser);
      Shown+=(sender,e)=>{
        // IE Tab-style owned overlay: unlike cross-process SetParent, a native
        // top-level owned WS_POPUP paints reliably over Chromium's GPU surface.
        // It visually occupies only the current tab content rectangle.
        SetWindowLongPtr(Handle,GWLP_HWNDPARENT,parent);
        if(GetWindow(Handle,GW_OWNER)!=parent){
          Emit("ERROR","La surface IE native ne peut pas être liée à la fenêtre DevGitBrowser. Erreur : "+Marshal.GetLastWin32Error());Close();return;
        }
        if(!SetWindowPos(Handle,HWND_TOP,x,y,Math.Max(1,w),Math.Max(1,h),SWP_FRAMECHANGED|SWP_SHOWWINDOW|SWP_NOACTIVATE)){
          Emit("ERROR","La surface IE native ne peut pas être affichée. Erreur : "+Marshal.GetLastWin32Error());Close();return;
        }
        try {popupSink=new BrowserPopupSink(this,browser);popupCookie=new AxHost.ConnectionPointCookie(browser.ComObject,popupSink,typeof(ILegacyNewWindowEvents));}
        catch(Exception ex){Emit("ERROR","Impossible de garder les fenêtres IE dans MSHTML : "+ex.Message);Close();return;}
        Emit("ATTACHED","OWNED_OVERLAY");
        if(SafeAddress(address))browser.Navigate(address); else Emit("ERROR","Adresse HTTP(S) invalide.");
      };
      FormClosed+=(sender,e)=>{try{popupCookie?.Disconnect();}catch{} foreach(var p in popups.ToArray())try{p.Close();}catch{} Emit("CLOSED","");};
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
        else if(code=="TESTPOPUP") {var link=browser.Document?.GetElementById("popup");if(link!=null)link.InvokeMember("click");else Emit("ERROR","Lien de test popup absent.");}
        else if(code=="QUIT")Close();
      }catch(Exception ex){Emit("ERROR",ex.Message);}
    }
    internal static bool IsModernVideoHost(string host) {
      host=(host??"").ToLowerInvariant();
      return host=="monvisio.com"||host.EndsWith(".monvisio.com")||host=="babelvisio.com"||host.EndsWith(".babelvisio.com");
    }
    // A popup is a real IE WebBrowser object, never an Electron/Chromium child.
    // The ppDisp return preserves window.open's opener relationship and scripting.
    internal void HandlePopup(ref object ppDisp,ref bool cancel,string target){
      if(!String.IsNullOrWhiteSpace(target)&&target!="about:blank"&&(!SafeAddress(target)||IsModernVideoHost(new Uri(target).Host))){
        cancel=true;Emit("POPUPBLOCKED","Cible IE non compatible ou adresse interdite.");return;
      }
      while(popupTimes.Count>0 && DateTime.UtcNow-popupTimes.Peek()>TimeSpan.FromMinutes(1))popupTimes.Dequeue();
      if(popups.Count>=12||popupTimes.Count>=18){cancel=true;Emit("POPUPBLOCKED","Limite anti-abus des fenêtres IE atteinte.");return;}
      LegacyPopupWindow popup=null;
      try {
        popup=new LegacyPopupWindow(this);
        popup.Show(this);
        popup.InitializeEvents();
        ppDisp=popup.Browser.ComObject;
        if(ppDisp==null)throw new InvalidOperationException("Objet MSHTML popup indisponible.");
        popupTimes.Enqueue(DateTime.UtcNow);popups.Add(popup);
        Emit("POPUP","Fenêtre IE ouverte");
        cancel=false;
      } catch(Exception ex){cancel=true;try{popup?.Close();}catch{} Emit("POPUPBLOCKED","Fenêtre IE impossible : "+ex.Message);}
    }
    internal void PopupClosed(LegacyPopupWindow p){popups.Remove(p);Emit("POPUPCLOSED","");}
    internal void PopupReady(string url){Emit("POPUPREADY",url);}
    internal void PopupError(string reason){Emit("POPUPBLOCKED",reason);}

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

// Minimal DWebBrowserEvents2 dispatch sink for the NewWindow3 event (DISPID 273).
// Event subscriptions do not require a dependency on proprietary IE Tab files.
[ComVisible(true),Guid("34A715A0-6587-11D0-924A-0020AFC7AC4D"),InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
public interface ILegacyNewWindowEvents {
  [DispId(273)]
  void NewWindow3([In,Out,MarshalAs(UnmanagedType.IDispatch)] ref object ppDisp,
    [In,Out,MarshalAs(UnmanagedType.VariantBool)] ref bool cancel,
    uint flags,[MarshalAs(UnmanagedType.BStr)] string urlContext,
    [MarshalAs(UnmanagedType.BStr)] string target);
}

public sealed class LegacyWebBrowser : WebBrowser {
  public object ComObject { get {return ActiveXInstance;} }
}

[ComVisible(true),ClassInterface(ClassInterfaceType.None)]
public sealed class BrowserPopupSink : StandardOleMarshalObject, ILegacyNewWindowEvents {
  readonly DevGitLegacyHost root;
  readonly LegacyWebBrowser browser;
  public BrowserPopupSink(DevGitLegacyHost root,LegacyWebBrowser browser){this.root=root;this.browser=browser;}
  public void NewWindow3(ref object ppDisp,ref bool cancel,uint flags,string context,string target){
    root.HandlePopup(ref ppDisp,ref cancel,target);
  }
}

public sealed class LegacyPopupWindow : Form {
  readonly DevGitLegacyHost root;
  readonly LegacyWebBrowser browser;
  BrowserPopupSink sink;
  AxHost.ConnectionPointCookie cookie;
  public LegacyWebBrowser Browser {get{return browser;}}
  public LegacyPopupWindow(DevGitLegacyHost root){
    this.root=root;
    Text="DevGitBrowser — IE11";StartPosition=FormStartPosition.CenterParent;
    Size=new Size(760,540);ShowInTaskbar=false;
    browser=new LegacyWebBrowser {Dock=DockStyle.Fill,ScriptErrorsSuppressed=true,AllowWebBrowserDrop=false};
    browser.Navigating+=(sender,e)=>{
      if(e.Url==null||e.Url.AbsoluteUri=="about:blank")return;
      if(!DevGitLegacyHost.IsModernVideoHost(e.Url.Host) && (e.Url.Scheme=="http"||e.Url.Scheme=="https") && String.IsNullOrEmpty(e.Url.UserInfo))return;
      e.Cancel=true;root.PopupError("Navigation externe dangereuse ou moderne bloquée dans IE.");
    };
    browser.DocumentCompleted+=(sender,e)=>{
      if(browser.Url!=null && e.Url==browser.Url && browser.ReadyState==WebBrowserReadyState.Complete)root.PopupReady(browser.Url.AbsoluteUri);
    };
    Controls.Add(browser);
    FormClosed+=(sender,e)=>{try{cookie?.Disconnect();}catch{} root.PopupClosed(this);};
  }
  public void InitializeEvents(){
    sink=new BrowserPopupSink(root,browser);
    cookie=new AxHost.ConnectionPointCookie(browser.ComObject,sink,typeof(ILegacyNewWindowEvents));
  }
}
