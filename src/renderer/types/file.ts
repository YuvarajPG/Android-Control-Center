export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: string;
  modified: string;
  permissions: string;
}

export interface FileListResult {
  currentPath: string;
  items: FileItem[];
}
