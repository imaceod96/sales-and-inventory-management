import {
  adminActor,
  assertEquals,
  createTestEngine,
  TestResult,
  TestSuiteResult,
} from './testUtils';
import { ExportBackupUseCase } from '../src/modules/core/application/ExportBackupUseCase';
import { RestoreBackupUseCase } from '../src/modules/core/application/RestoreBackupUseCase';
import { IndexedDbSystemBackupRepository } from '../src/modules/core/infrastructure/IndexedDbSystemBackupRepository';
import { sessionElevationService } from '../src/shared/lib/security/SessionElevationService';
import { ListProductsUseCase } from '../src/modules/warehouse/application/ListProductsUseCase';
import { GetProductHistoryUseCase } from '../src/modules/warehouse/application/GetProductHistoryUseCase';
import { GetWorkdayDetailUseCase } from '../src/modules/warehouse/application/GetWorkdayDetailUseCase';
import { OpenWorkdayUseCase } from '../src/modules/warehouse/application/OpenWorkdayUseCase';
import { RegisterProductWithInitialEntryUseCase } from '../src/modules/warehouse/application/RegisterProductWithInitialEntryUseCase';
import { IndexedDbProductRepository } from '../src/modules/warehouse/infrastructure/IndexedDbProductRepository';
import { IndexedDbCategoryRepository } from '../src/modules/warehouse/infrastructure/IndexedDbCategoryRepository';
import { IndexedDbMeasurementUnitRepository } from '../src/modules/warehouse/infrastructure/IndexedDbMeasurementUnitRepository';
import { IndexedDbMerchandiseEntryRepository } from '../src/modules/warehouse/infrastructure/IndexedDbMerchandiseEntryRepository';
import { IndexedDbInventoryMovementRepository } from '../src/modules/warehouse/infrastructure/IndexedDbInventoryMovementRepository';
import { IndexedDbPriceChangeRepository } from '../src/modules/warehouse/infrastructure/IndexedDbPriceChangeRepository';
import { IndexedDbProductStatusChangeRepository } from '../src/modules/warehouse/infrastructure/IndexedDbProductStatusChangeRepository';
import { StoreName } from '../src/shared/lib/indexeddb/schema';

export interface PerformanceBenchmarkResult {
  readonly productCount: number;
  readonly seedTimeMs: number;
  readonly catalogLoadTimeMs: number;
  readonly searchTimeMs: number;
  readonly kardexQueryTimeMs: number;
  readonly reportGenTimeMs: number;
  readonly backupExportTimeMs: number;
  readonly backupRestoreTimeMs: number;
}

export async function runVolumePerformanceBenchmarks(): Promise<{
  readonly suiteResult: TestSuiteResult;
  readonly benchmarks: readonly PerformanceBenchmarkResult[];
}> {
  const tests: TestResult[] = [];
  const benchmarks: PerformanceBenchmarkResult[] = [];
  const startSuiteTime = Date.now();

  const volumesToTest = [100, 1000, 5000];

  for (const volume of volumesToTest) {
    try {
      const startSeed = Date.now();
      const engine = await createTestEngine();

      const productRepo = new IndexedDbProductRepository(engine);
      const categoryRepo = new IndexedDbCategoryRepository(engine);
      const unitRepo = new IndexedDbMeasurementUnitRepository(engine);
      const merchandiseRepo = new IndexedDbMerchandiseEntryRepository(engine);
      const movementRepo = new IndexedDbInventoryMovementRepository(engine);
      const priceRepo = new IndexedDbPriceChangeRepository(engine);
      const statusRepo = new IndexedDbProductStatusChangeRepository(engine);

      // 1. Población inicial de catálogos base y jornada
      await engine.runTransaction([StoreName.SYSTEM_METADATA, StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS], 'readwrite', async (tx) => {
        await tx.insert(StoreName.SYSTEM_METADATA, { id: 'admin_pin_credentials', hashHex: 'bench_hash', saltHex: 's', iterations: 100000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-bench', name: 'Categoría Bench', normalizedName: 'CATEGORIA BENCH', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        await tx.insert(StoreName.WAREHOUSE_UNITS, { id: 'u-bench', name: 'Unidad Bench', symbol: 'ub', normalizedName: 'UNIDAD BENCH', precisionDigits: 0, isSystemUnit: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      });

      const openWorkdayUseCase = new OpenWorkdayUseCase(engine);
      const { workday } = await openWorkdayUseCase.execute(adminActor, {});

      const registerProduct = new RegisterProductWithInitialEntryUseCase(engine);
      let sampleProductId = '';

      for (let idx = 1; idx <= volume; idx++) {
        const prod = await registerProduct.execute(adminActor, {
          name: `Producto Rendimiento ${volume}-${idx}`,
          sku: `SKU-B${volume}-${idx}`,
          categoryId: 'cat-bench',
          measurementUnitId: 'u-bench',
          initialQuantity: 100,
          unitPurchasePrice: 15,
          declaredSalePrice: 25,
        });

        if (idx === Math.floor(volume / 2)) {
          sampleProductId = prod.id;
        }
      }

      const seedTimeMs = Date.now() - startSeed;

      // 2. Medir Carga de Catálogo Completo
      const listProductsUseCase = new ListProductsUseCase(productRepo, categoryRepo, unitRepo);
      const startCat = Date.now();
      const catalog = await listProductsUseCase.execute(adminActor);
      const catalogLoadTimeMs = Date.now() - startCat;
      assertEquals(catalog.length, volume, `Catálogo de ${volume} productos cargado correctamente`);

      // 3. Medir Búsqueda en memoria por SKU / Nombre
      const targetSku = `SKU-B${volume}-${Math.floor(volume / 2)}`;
      const startSearch = Date.now();
      const searchResult = catalog.filter(
        (p) => p.sku === targetSku || p.name.toLowerCase().includes('50')
      );
      const searchTimeMs = Date.now() - startSearch;
      assertEquals(searchResult.length > 0, true, 'Búsqueda por SKU/Nombre exitosa');

      // 4. Medir Consulta de Kardex
      const getKardexUseCase = new GetProductHistoryUseCase(
        productRepo,
        categoryRepo,
        unitRepo,
        merchandiseRepo,
        movementRepo,
        priceRepo,
        statusRepo
      );
      const startKardex = Date.now();
      const kardex = await getKardexUseCase.execute(adminActor, { productId: sampleProductId });
      const kardexQueryTimeMs = Date.now() - startKardex;
      assertEquals(kardex.summary.productId, sampleProductId, 'Consulta de Kardex exitosa');

      // 5. Medir Generación de Informe de Jornada
      const getWorkdayDetailUseCase = new GetWorkdayDetailUseCase(engine);
      const startReport = Date.now();
      const report = await getWorkdayDetailUseCase.execute(adminActor, workday.id);
      const reportGenTimeMs = Date.now() - startReport;
      assertEquals(Boolean(report.workday.id), true, 'Generación de informe de rendimiento exitosa');

      // 6. Medir Exportación de Respaldo Local
      const backupRepo = new IndexedDbSystemBackupRepository(engine);
      let savedBackupText = '';
      const mockFilePort = {
        saveJsonBackup: async (_fileName: string, content: string) => {
          savedBackupText = content;
        },
        readJsonFile: async (file: File) => file.text(),
      };
      const exportUseCase = new ExportBackupUseCase(backupRepo, mockFilePort as any);
      const startExport = Date.now();
      await exportUseCase.execute(adminActor);
      const backupExportTimeMs = Date.now() - startExport;
      assertEquals(Boolean(savedBackupText.length), true, 'Exportación de respaldo completada');

      // 7. Medir Restauración Atómica de Respaldo
      const targetEngine = await createTestEngine();
      await targetEngine.runTransaction([StoreName.SYSTEM_METADATA], 'readwrite', async (tx) => {
        await tx.insert(StoreName.SYSTEM_METADATA, { id: 'admin_pin_credentials', hashHex: 'target_hash', saltHex: 's', iterations: 100000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      });
      const backupRepoTarget = new IndexedDbSystemBackupRepository(targetEngine);
      const restoreUseCase = new RestoreBackupUseCase(backupRepoTarget, mockFilePort as any);
      const mockFile = { name: 'bench.json', text: async () => savedBackupText } as unknown as File;

      const startRestore = Date.now();
      await restoreUseCase.execute(adminActor, mockFile, sessionElevationService.issueCriticalToken(adminActor, 'RESTORE_BACKUP'));
      const backupRestoreTimeMs = Date.now() - startRestore;

      benchmarks.push({
        productCount: volume,
        seedTimeMs,
        catalogLoadTimeMs,
        searchTimeMs,
        kardexQueryTimeMs,
        reportGenTimeMs,
        backupExportTimeMs,
        backupRestoreTimeMs,
      });

      tests.push({
        name: `Prueba de rendimiento y volumen con ${volume} productos (Carga: ${catalogLoadTimeMs}ms, Búsqueda: ${searchTimeMs}ms, Kardex: ${kardexQueryTimeMs}ms, Exportación: ${backupExportTimeMs}ms, Restauración: ${backupRestoreTimeMs}ms)`,
        passed: true,
        durationMs: Date.now() - startSeed,
      });
    } catch (err: any) {
      console.error(`Error en volumen ${volume}:`, err.stack || err.message || err);
      tests.push({
        name: `Prueba de rendimiento y volumen con ${volume} productos`,
        passed: false,
        durationMs: 0,
        error: err.message || String(err),
      });
    }
  }

  const passedCount = tests.filter((t) => t.passed).length;
  return {
    suiteResult: {
      name: 'PRUEBAS DE RENDIMIENTO Y VOLUMEN (BLOQUE 9.6)',
      tests,
      total: tests.length,
      passed: passedCount,
      failed: tests.length - passedCount,
      durationMs: Date.now() - startSuiteTime,
    },
    benchmarks,
  };
}
