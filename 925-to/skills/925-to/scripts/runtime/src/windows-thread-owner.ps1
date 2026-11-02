param([Parameter(Mandatory=$true)][string]$LiteralPath)
$ErrorActionPreference='Stop'
# Observation only: no RmShutdown, RmRestart or process-control API is declared.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class TeamThreadLock {
 [StructLayout(LayoutKind.Sequential)] public struct Stamp { public uint Low; public uint High; }
 [StructLayout(LayoutKind.Sequential)] public struct Unique { public uint Pid; public Stamp Start; }
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct Info {
  public Unique Process;
  [MarshalAs(UnmanagedType.ByValTStr,SizeConst=256)] public string Name;
  [MarshalAs(UnmanagedType.ByValTStr,SizeConst=64)] public string Service;
  public uint Type; public uint Status; public uint Session;
  [MarshalAs(UnmanagedType.Bool)] public bool Restartable;
 }
 [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)] static extern int RmStartSession(out uint session,int flags,StringBuilder key);
 [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)] static extern int RmRegisterResources(uint session,uint files,string[] names,uint applications,Unique[] processes,uint services,string[] serviceNames);
 [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint session,out uint needed,ref uint count,[In,Out] Info[] list,ref uint reasons);
 [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint session);
 public static Info[] Read(string path) {
  uint session;int status=RmStartSession(out session,0,new StringBuilder(64));if(status!=0)throw new Exception("RmStartSession "+status);
  try {
   status=RmRegisterResources(session,1,new string[]{path},0,null,0,null);if(status!=0)throw new Exception("RmRegisterResources "+status);
   uint needed=0,count=0,reasons=0;status=RmGetList(session,out needed,ref count,null,ref reasons);
   if(status==0)return new Info[0];
   for(int attempt=0;attempt<3&&status==234;attempt++) {
    if(needed>256)throw new Exception("Too many resource owners");count=needed;Info[] values=new Info[count];status=RmGetList(session,out needed,ref count,values,ref reasons);
    if(status==0){Array.Resize(ref values,(int)count);return values;}
   }
   throw new Exception("RmGetList "+status);
  } finally {RmEndSession(session);}
 }
}
'@
$rows=@([TeamThreadLock]::Read($LiteralPath)|ForEach-Object{[ordered]@{pid=[int]$_.Process.Pid;createdAt=(([uint64]$_.Process.Start.High -shl 32) -bor [uint64]$_.Process.Start.Low).ToString()}})
ConvertTo-Json -InputObject $rows -Compress
