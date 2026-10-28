export interface BackupFileInput {
  readonly name: string;
  readText(): Promise<string>;
}

export interface BackupFilePort {
  saveJsonBackup(fileName: string, serializedContent: string): Promise<void>;
  readJsonFile(file: File | BackupFileInput | string): Promise<string>;
}

