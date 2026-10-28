import { PersistenceError } from '../../../shared/types/errors';
import { BackupFileInput, BackupFilePort } from '../domain/ports/BackupFilePort';

export class BrowserBackupFileAdapter implements BackupFilePort {
  public async saveJsonBackup(fileName: string, serializedContent: string): Promise<void> {
    if (typeof document === 'undefined' || typeof URL === 'undefined') {
      throw new PersistenceError('El entorno actual no permite descargar archivos locales.');
    }

    const blob = new Blob([serializedContent], { type: 'application/json;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);

    try {
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }
  }

  public async readJsonFile(file: File | BackupFileInput | string): Promise<string> {
    try {
      if (typeof file === 'string') {
        return file;
      }
      if (file && typeof file === 'object' && 'readText' in file && typeof file.readText === 'function') {
        return await file.readText();
      }
      if (file && typeof file === 'object' && 'text' in file && typeof file.text === 'function') {
        return await (file as File).text();
      }
      throw new PersistenceError('Formato de entrada de archivo no soportado.');
    } catch (err: unknown) {
      if (err instanceof PersistenceError) throw err;
      throw new PersistenceError('No fue posible leer el archivo seleccionado.');
    }
  }
}
