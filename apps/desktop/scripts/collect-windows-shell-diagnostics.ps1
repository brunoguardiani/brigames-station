param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '../out/windows-shell-diagnostics'),
  [ValidateRange(1, 10)][int]$Samples = 3
)

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This diagnostic requires Windows.' }

# Read-only snapshots: no focus changes, keyboard injection, or process restarts.
# GUI state: https://learn.microsoft.com/windows/win32/api/winuser/ns-winuser-guithreadinfo
# Wait chains: https://learn.microsoft.com/windows/win32/api/wct/nf-wct-getthreadwaitchain
if (-not ('BrigamesShellDiagnostics' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class BrigamesShellDiagnostics {
  [StructLayout(LayoutKind.Sequential)]
  public struct GuiInfo {
    public uint Size, Flags;
    public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
    public int Left, Top, Right, Bottom;
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct WctLock {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Name;
    public long Timeout;
    public int Alertable;
  }
  public class WindowInfo {
    public long Handle;
    public uint ProcessId, ThreadId;
    public string ClassName;
    public bool Visible, Minimized, Hung, MessageResponded;
    public int MessageError;
  }
  public class WaitNode {
    public int Type, Status;
    public uint? ProcessId, ThreadId, WaitTime;
  }
  public class WaitInfo {
    public uint ThreadId;
    public int Error;
    public bool Deadlock;
    public List<WaitNode> Nodes = new List<WaitNode>();
  }
  private delegate bool EnumWindowCallback(IntPtr window, IntPtr param);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowCallback callback, IntPtr param);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int length);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] private static extern bool IsHungAppWindow(IntPtr window);
  [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wparam, IntPtr lparam, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll", SetLastError = true)] private static extern bool GetGUIThreadInfo(uint threadId, ref GuiInfo info);
  [DllImport("advapi32.dll", SetLastError = true)] private static extern IntPtr OpenThreadWaitChainSession(uint flags, IntPtr callback);
  [DllImport("advapi32.dll")] private static extern void CloseThreadWaitChainSession(IntPtr session);
  [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetThreadWaitChain(IntPtr session, UIntPtr context, uint flags, uint threadId, ref uint count, IntPtr nodes, out int cycle);

  public static List<WindowInfo> Windows(uint[] processIds) {
    var targets = new HashSet<uint>(processIds);
    var windows = new List<WindowInfo>();
    EnumWindows((window, unused) => {
      uint processId;
      uint threadId = GetWindowThreadProcessId(window, out processId);
      if (!targets.Contains(processId)) return true;
      var name = new StringBuilder(256);
      GetClassName(window, name, name.Capacity);
      UIntPtr result;
      // WM_NULL with SMTO_BLOCK | SMTO_ABORTIFHUNG | SMTO_ERRORONEXIT.
      bool responded = SendMessageTimeout(window, 0, UIntPtr.Zero, IntPtr.Zero, 0x23, 250, out result) != IntPtr.Zero;
      int error = responded ? 0 : Marshal.GetLastWin32Error();
      windows.Add(new WindowInfo {
        Handle = window.ToInt64(), ProcessId = processId, ThreadId = threadId,
        ClassName = name.ToString(), Visible = IsWindowVisible(window),
        Minimized = IsIconic(window), Hung = IsHungAppWindow(window),
        MessageResponded = responded, MessageError = error
      });
      return true;
    }, IntPtr.Zero);
    return windows;
  }
  public static GuiInfo? Gui(uint threadId) {
    var info = new GuiInfo { Size = (uint)Marshal.SizeOf(typeof(GuiInfo)) };
    return GetGUIThreadInfo(threadId, ref info) ? (GuiInfo?)info : null;
  }
  public static WaitInfo Wait(uint threadId) {
    var result = new WaitInfo { ThreadId = threadId };
    IntPtr session = OpenThreadWaitChainSession(0, IntPtr.Zero);
    if (session == IntPtr.Zero) { result.Error = Marshal.GetLastWin32Error(); return result; }
    // Two DWORDs followed by the largest union member, aligned to 8 bytes.
    int stride = 8 + Marshal.SizeOf(typeof(WctLock));
    IntPtr nodes = IntPtr.Zero;
    try {
      nodes = Marshal.AllocHGlobal(stride * 16);
      uint count = 16;
      int cycle;
      bool succeeded = GetThreadWaitChain(session, UIntPtr.Zero, 1, threadId, ref count, nodes, out cycle);
      result.Error = succeeded ? 0 : Marshal.GetLastWin32Error();
      // ERROR_MORE_DATA still supplies a valid truncated chain.
      if (!succeeded && result.Error != 234 && result.Error != 565) return result;
      result.Deadlock = cycle != 0;
      for (int i = 0; i < Math.Min(count, 16); i++) {
        IntPtr node = IntPtr.Add(nodes, i * stride);
        var entry = new WaitNode { Type = Marshal.ReadInt32(node), Status = Marshal.ReadInt32(node, 4) };
        if (entry.Type == 8) {
          entry.ProcessId = (uint)Marshal.ReadInt32(node, 8);
          entry.ThreadId = (uint)Marshal.ReadInt32(node, 12);
          entry.WaitTime = (uint)Marshal.ReadInt32(node, 16);
        }
        // Omit lock names, window titles and command lines from the report.
        result.Nodes.Add(entry);
      }
    } finally {
      if (nodes != IntPtr.Zero) Marshal.FreeHGlobal(nodes);
      CloseThreadWaitChainSession(session);
    }
    return result;
  }
}
'@
}

$warnings = [System.Collections.Generic.List[string]]::new()
$osInfo = $null
$gpuInfo = @()
try { $osInfo = Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber }
catch { $warnings.Add('OS metadata: ' + $_.Exception.Message) }
try { $gpuInfo = @(Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion) }
catch { $warnings.Add('GPU metadata: ' + $_.Exception.Message) }

$snapshots = @()
for ($sampleIndex = 0; $sampleIndex -lt $Samples; $sampleIndex++) {
  $processes = @(Get-Process | Where-Object { $_.ProcessName -in @('brigames-station', 'explorer', 'dwm', 'ShellExperienceHost', 'StartMenuExperienceHost') })
  $windows = @([BrigamesShellDiagnostics]::Windows([uint32[]]@($processes.Id)))
  $guiThreads = @($windows | Select-Object -ExpandProperty ThreadId -Unique | ForEach-Object {
    $threadId = $_
    $gui = [BrigamesShellDiagnostics]::Gui($threadId)
    [PSCustomObject]@{
      ThreadId = $threadId
      Gui = $gui
      InMoveSize = $null -ne $gui -and ($gui.Flags -band 2) -ne 0
      InMenu = $null -ne $gui -and ($gui.Flags -band 4) -ne 0
      InSystemMenu = $null -ne $gui -and ($gui.Flags -band 8) -ne 0
      InPopupMenu = $null -ne $gui -and ($gui.Flags -band 16) -ne 0
      WaitChain = [BrigamesShellDiagnostics]::Wait($threadId)
    }
  })
  $processInfo = @($processes | ForEach-Object {
    $targetProcess = $_
    $metadata = [ordered]@{ Name = $targetProcess.ProcessName; Id = $targetProcess.Id }
    try {
      $metadata['CpuSeconds'] = $targetProcess.CPU
      $metadata['WorkingSetBytes'] = $targetProcess.WorkingSet64
      $metadata['Handles'] = $targetProcess.HandleCount
      $metadata['Threads'] = $targetProcess.Threads.Count
      if ($targetProcess.ProcessName -eq 'brigames-station') { $metadata['Version'] = $targetProcess.MainModule.FileVersionInfo.ProductVersion }
    } catch { $warnings.Add('Process ' + $targetProcess.Id + ': ' + $_.Exception.Message) }
    [PSCustomObject]$metadata
  })
  $snapshots += [PSCustomObject]@{
    Timestamp = (Get-Date).ToUniversalTime().ToString('o')
    Processes = $processInfo
    Windows = $windows
    GuiThreads = $guiThreads
  }
  if ($sampleIndex + 1 -lt $Samples) { Start-Sleep -Milliseconds 1000 }
}

$report = [PSCustomObject]@{
  OS = $osInfo
  GPU = $gpuInfo
  Warnings = @($warnings.ToArray())
  Snapshots = $snapshots
}
$directory = [IO.Path]::GetFullPath($OutputDirectory)
[void][IO.Directory]::CreateDirectory($directory)
$reportPath = Join-Path $directory ('shell-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.json')
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Output $reportPath
