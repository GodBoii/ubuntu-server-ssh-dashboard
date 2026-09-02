export type HealthLevel = "healthy" | "degraded" | "stopped" | "connecting";

export type ContainerInfo = {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  health: string | null;
  ports: string;
  project: string | null;
  service: string | null;
  restartPolicy: string;
  startedAt: string | null;
};

export type StackId = "ai-os" | "delta-exchange" | "trader";

export type StackInfo = {
  id: StackId;
  name: string;
  path: string;
  running: number;
  total: number;
  status: "healthy" | "degraded" | "stopped";
  containers: string[];
};

export type ServiceInfo = {
  name: string;
  enabled: boolean;
  active: boolean;
  state: string;
  subState: string;
  loaded: boolean;
  activeSeconds: number | null;
};

export type ProcessInfo = { pid: number; cpu: number; memory: number; command: string };

/** Raw jiffies. Two samples become a CPU percentage; one sample means nothing on its own. */
export type CpuSample = { total: number; idle: number };
export type NetworkSample = { receivedBytes: number; transmittedBytes: number };

export type MemoryUsage = { total: number; used: number; available: number; swapTotal: number; swapUsed: number };
export type DiskUsage = { total: number; used: number; available: number };

export type Overview = {
  protocol: number;
  host: string;
  kernel: string;
  uptimeSeconds: number;
  load: [number, number, number];
  cpuCount: number;
  cpuSample: CpuSample | null;
  memory: MemoryUsage;
  disk: DiskUsage;
  network: NetworkSample | null;
  temperature: number | null;
  containers: ContainerInfo[];
  stacks: StackInfo[];
  services: ServiceInfo[];
  processes: ProcessInfo[];
  timestamp: number;
};

export type FileEntry = { name: string; path: string; kind: "directory" | "file"; size: number; modified: number };
export type DirectoryListing = { path: string; parent: string | null; entries: FileEntry[] };
export type FileContent = { path: string; content: string; modified: number; size: number };
export type ActionResult = { message: string };
export type Session = { token: string; host: string; startedAt: number };

export type AuditEntry = {
  id: string;
  timestamp: string;
  action: string;
  target: string;
  outcome: "success" | "failure";
  detail: string;
  durationMs: number | null;
};

export type AppId = "overview" | "containers" | "logs" | "terminal" | "files" | "services" | "activity";

/** One derived reading of the host, used for sparklines and rate readouts. */
export type Telemetry = {
  at: number;
  cpuPercent: number | null;
  memoryPercent: number;
  diskPercent: number;
  loadPercent: number;
  receivedBytesPerSecond: number | null;
  transmittedBytesPerSecond: number | null;
};
