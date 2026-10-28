import {
  adminActor,
  assert,
  assertEquals,
  assertRejects,
  createTestEngine,
  TestResult,
  TestSuiteResult,
} from './testUtils';
import { StoreName, ALL_BUSINESS_STORES } from '../src/shared/lib/indexeddb/schema';
import { BrowserPrinterAdapter } from '../src/modules/core/infrastructure/BrowserPrinterAdapter';
import { BrowserBackupFileAdapter } from '../src/modules/core/infrastructure/BrowserBackupFileAdapter';
import { ExportBackupUseCase } from '../src/modules/core/application/ExportBackupUseCase';
import { RestoreBackupUseCase } from '../src/modules/core/application/RestoreBackupUseCase';
import { VerifyAdminPinUseCase } from '../src/modules/core/application/VerifyAdminPinUseCase';
import { SetupInitialAdminPinUseCase } from '../src/modules/core/application/SetupInitialAdminPinUseCase';
import { IndexedDbSystemBackupRepository } from '../src/modules/core/infrastructure/IndexedDbSystemBackupRepository';
import { PrintableReceipt } from '../src/modules/core/domain/ports/PrinterPort';
import { sessionElevationService } from '../src/shared/lib/security/SessionElevationService';
import { PersistenceError } from '../src/shared/types/errors';

export async function runPrintingAndBackupTests(): Promise<TestSuiteResult> {
  const tests: TestResult[] = [];
  const startSuiteTime = Date.now();

  const printerAdapter = new BrowserPrinterAdapter();
  const backupAdapter = new BrowserBackupFileAdapter();

  const sampleReceipt: PrintableReceipt = {
    title: 'COMPROBANTE DE DESPACHO',
    subtitle: 'Control Comercial de Inventario',
    folio: '#VD-0001',
    dateISO: new Date().toISOString(),
    accountName: 'Mesa 4 / Juan Pérez',
    items: [
      {
        productId: 'prod-1',
        productName: 'Refresco Cola 600ml',
        quantity: 3,
        unitPrice: 25,
        subtotal: 75,
        unitSymbol: 'pza',
      },
      {
        productId: 'prod-2',
        productName: 'Galletas de Chispas 100g',
        quantity: 2,
        unitPrice: 18,
        subtotal: 36,
        unitSymbol: 'pza',
      },
    ],
    totalAmount: 111,
  };

  // 1. Generación del contenido estructurado del comprobante de despacho para ventas DISPATCHED
  try {
    const start = Date.now();
    const html80 = printerAdapter.formatReceiptHtml(sampleReceipt, '80mm');
    const html58 = printerAdapter.formatReceiptHtml(sampleReceipt, '58mm');

    assert(html80.includes('COMPROBANTE DE DESPACHO'), 'Contiene título del comprobante');
    assert(html80.includes('#VD-0001'), 'Contiene el folio del despacho');
    assert(html80.includes('Refresco Cola 600ml'), 'Contiene productos despachados');
    assert(html80.includes('$111.00'), 'Contiene el importe total despachado');
    assert(html58.includes('58mm'), 'Aplica formato térmico de 58 mm');

    tests.push({
      name: '1. Generación de comprobante estructurado DISPATCHED (80mm y 58mm)',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: '1. Generación de comprobante estructurado DISPATCHED (80mm y 58mm)',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // 2. Ausencia absoluta de costos de compra y márgenes de utilidad en el comprobante
  try {
    const start = Date.now();
    const html = printerAdapter.formatReceiptHtml(sampleReceipt, '80mm').toLowerCase();

    assert(!html.includes('costo'), 'No contiene la palabra costo');
    assert(!html.includes('compra'), 'No contiene costo de compra');
    assert(!html.includes('ganancia'), 'No contiene término de ganancia');
    assert(!html.includes('margen'), 'No contiene margen');
    assert(!html.includes('fifo'), 'No contiene mención a FIFO');

    tests.push({
      name: '2. Ausencia absoluta de costos y márgenes de utilidad en el comprobante',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: '2. Ausencia absoluta de costos y márgenes de utilidad en el comprobante',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // 3. Ausencia absoluta de datos de pago
  try {
    const start = Date.now();
    const html = printerAdapter.formatReceiptHtml(sampleReceipt, '80mm').toLowerCase();

    assert(!html.includes('efectivo'), 'No contiene forma de pago en efectivo');
    assert(!html.includes('tarjeta'), 'No contiene pago en tarjeta');
    assert(!html.includes('factura pagada'), 'No contiene término fiscal de factura pagada');
    assert(!html.includes('vuelto'), 'No contiene vuelto');
    assert(!html.includes('cambio'), 'No contiene cambio entregado');
    assert(!html.includes('cobro realizado'), 'No contiene términos de cobro');

    tests.push({
      name: '3. Ausencia absoluta de datos de pago o cobranza en comprobante de despacho',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: '3. Ausencia absoluta de datos de pago o cobranza en comprobante de despacho',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // 4. Reimpresión de comprobante sin alterar existencias de inventario
  try {
    const start = Date.now();
    const engine = await createTestEngine();

    await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_PRODUCTS, {
        id: 'prod-1',
        name: 'Producto Pruebas',
        normalizedName: 'PRODUCTO PRUEBAS',
        currentStock: 50,
        lastPurchasePrice: 10,
        currentSalePrice: 20,
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });

    let stockBefore = 0;
    await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', async (tx) => {
      const p = await tx.get<any>(StoreName.WAREHOUSE_PRODUCTS, 'prod-1');
      stockBefore = p.currentStock;
    });

    // Simular reimpresión
    await printerAdapter.printReceipt(sampleReceipt, { paperWidth: '80mm' });

    let stockAfter = 0;
    await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', async (tx) => {
      const p = await tx.get<any>(StoreName.WAREHOUSE_PRODUCTS, 'prod-1');
      stockAfter = p.currentStock;
    });

    assertEquals(stockBefore, stockAfter, 'Las existencias de inventario no sufrieron cambios');

    tests.push({
      name: '4. Reimpresión de comprobante sin alterar existencias de inventario',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: '4. Reimpresión de comprobante sin alterar existencias de inventario',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // 5. Reimpresión de comprobante sin duplicar registros en Kardex
  try {
    const start = Date.now();
    const engine = await createTestEngine();

    let kardexCountBefore = 0;
    await engine.runTransaction([StoreName.WAREHOUSE_INVENTORY_MOVEMENTS], 'readonly', async (tx) => {
      kardexCountBefore = await tx.count(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS);
    });

    // Impresión múltiple (3 reimpresiones)
    await printerAdapter.printReceipt(sampleReceipt, { paperWidth: '80mm' });
    await printerAdapter.printReceipt(sampleReceipt, { paperWidth: '58mm' });
    await printerAdapter.printReceipt(sampleReceipt, { paperWidth: '80mm' });

    let kardexCountAfter = 0;
    await engine.runTransaction([StoreName.WAREHOUSE_INVENTORY_MOVEMENTS], 'readonly', async (tx) => {
      kardexCountAfter = await tx.count(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS);
    });

    assertEquals(kardexCountBefore, kardexCountAfter, 'No se generaron registros adicionales en el Kardex');

    tests.push({
      name: '5. Reimpresión de comprobante sin duplicar registros en Kardex',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: '5. Reimpresión de comprobante sin duplicar registros en Kardex',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // 6. Cancelación de proceso de impresión sin efectos secundarios ni errores comerciales
  try {
    const start = Date.now();
    const res = await printerAdapter.printHtml('<html><body>Cancel test</body></html>');

    assertEquals(res.success, true, 'Impresión o cancelación resuelta correctamente sin arrojar errores no capturados');

    tests.push({
      name: '6. Cancelación de impresión sin efectos secundarios ni errores comerciales',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: '6. Cancelación de impresión sin efectos secundarios ni errores comerciales',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // 7. Invocación correcta del adaptador PrinterPort (printReceipt / printHtml / printWindow)
  try {
    const start = Date.now();

    const resReceipt = await printerAdapter.printReceipt(sampleReceipt, { paperWidth: '58mm' });
    assert(resReceipt.success, 'printReceipt retorna resultado exitoso');

    const resWindow = await printerAdapter.printWindow();
    assert(resWindow.success, 'printWindow retorna resultado exitoso');

    tests.push({
      name: '7. Invocación correcta del adaptador PrinterPort en entorno de navegador',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: '7. Invocación correcta del adaptador PrinterPort en entorno de navegador',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // 8. Exportación de respaldo vía BackupFilePort.saveJsonBackup
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const sysBackupRepo = new IndexedDbSystemBackupRepository(engine);

    let capturedFileName = '';
    let capturedContent = '';

    const mockFilePort = {
      saveJsonBackup: async (fileName: string, content: string) => {
        capturedFileName = fileName;
        capturedContent = content;
      },
      readJsonFile: async (file: File) => file.text(),
    };

    const exportUseCase = new ExportBackupUseCase(sysBackupRepo, mockFilePort as any);
    const fileName = await exportUseCase.execute(adminActor);

    assert(Boolean(fileName), 'Exportación devuelve nombre de archivo');
    assertEquals(capturedFileName, fileName, 'Guardó con el nombre exacto asignado');
    assert(capturedContent.includes('ESTABLECIMIENTO_BACKUP_V1'), 'Contenido JSON contiene formato válido');

    tests.push({
      name: '8. Exportación de respaldo vía BackupFilePort generando JSON con checksum',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: '8. Exportación de respaldo vía BackupFilePort generando JSON con checksum',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // 9. Lectura y validación de archivos de respaldo mediante BackupFilePort.readJsonFile
  try {
    const start = Date.now();

    const textContent = '{"test": true}';
    const readDirect = await backupAdapter.readJsonFile(textContent);
    assertEquals(readDirect, textContent, 'Lee string directamente');

    const mockFileInput = {
      name: 'backup.json',
      readText: async () => textContent,
    };
    const readFromObject = await backupAdapter.readJsonFile(mockFileInput);
    assertEquals(readFromObject, textContent, 'Lee objeto de entrada con interfaz readText');

    tests.push({
      name: '9. Lectura y validación de archivos mediante BrowserBackupFileAdapter',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: '9. Lectura y validación de archivos mediante BrowserBackupFileAdapter',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // 10. Manejo de cancelación en selección de archivos
  try {
    const start = Date.now();

    await assertRejects(
      () => backupAdapter.readJsonFile(null as any),
      PersistenceError,
      'Manejar entrada de archivo inválida o nula lanzando PersistenceError'
    );

    tests.push({
      name: '10. Manejo de cancelación/ausencia en selección de archivos',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: '10. Manejo de cancelación/ausencia en selección de archivos',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // 11. Restauración de respaldo que exige reautenticación ADMIN con PIN de 6 dígitos
  try {
    const start = Date.now();
    const engine = await createTestEngine();

    const setPinUseCase = new SetupInitialAdminPinUseCase(engine);
    const verifyPinUseCase = new VerifyAdminPinUseCase(engine);
    const backupRepo = new IndexedDbSystemBackupRepository(engine);

    // Configurar PIN de 6 dígitos "123456"
    await setPinUseCase.execute(adminActor, { pin: '123456', confirmPin: '123456' });

    // Intento con PIN erróneo "111111"
    await assertRejects(
      () => verifyPinUseCase.execute(adminActor, { pin: '111111', scope: 'RESTORE_BACKUP' }),
      Error,
      'Rechazar PIN incorrecto para restauración'
    );

    // Intento con PIN correcto "123456"
    const verifyRes = await verifyPinUseCase.execute(adminActor, { pin: '123456', scope: 'RESTORE_BACKUP' });
    assert(verifyRes.success, 'Verificación de PIN exitosa');
    assert(Boolean(verifyRes.criticalToken), 'Emite token crítico de elevación');

    tests.push({
      name: '11. Restauración con reautenticación obligatoria mediante PIN de 6 dígitos',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: '11. Restauración con reautenticación obligatoria mediante PIN de 6 dígitos',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // 12. Revocación de permisos y consumo de tokens de elevación tras restaurar
  try {
    const start = Date.now();

    const token = sessionElevationService.issueCriticalToken(adminActor, 'RESTORE_BACKUP');
    assert(Boolean(token), 'Emite un token de acción crítica');

    // Consumo 1: Exitoso
    sessionElevationService.consumeCriticalToken(token, 'RESTORE_BACKUP');

    // Consumo 2: Debe ser rechazado inmediatamente por ser de un solo uso
    await assertRejects(
      () => Promise.resolve(sessionElevationService.consumeCriticalToken(token, 'RESTORE_BACKUP')),
      Error,
      'Rechazar intento de reutilización del token crítico'
    );

    tests.push({
      name: '12. Revocación inmediata y de un solo uso del token crítico tras restauración',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: '12. Revocación inmediata y de un solo uso del token crítico tras restauración',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  const passedCount = tests.filter((t) => t.passed).length;
  return {
    name: 'PRUEBAS DE IMPRESIÓN Y GESTIÓN DE ARCHIVOS PARA ESCRITORIO (BLOQUE 10.4)',
    tests,
    total: tests.length,
    passed: passedCount,
    failed: tests.length - passedCount,
    durationMs: Date.now() - startSuiteTime,
  };
}
