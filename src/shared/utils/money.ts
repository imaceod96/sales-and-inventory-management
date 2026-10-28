import { ValidationError } from '../types/errors';

/**
 * Valida que una cantidad sea estrictamente numérica, finita, mayor que cero
 * y que contenga como máximo dos decimales.
 */
export function validateQuantity(quantity: number, contextLabel = 'La cantidad'): void {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity)) {
    throw new ValidationError(`${contextLabel} debe ser un valor numérico válido.`);
  }

  if (quantity <= 0) {
    throw new ValidationError(`${contextLabel} debe ser mayor que cero.`);
  }

  // Verifica que no tenga más de 2 decimales
  const decimalsPart = (quantity.toString().split('.')[1] || '').length;
  if (decimalsPart > 2) {
    throw new ValidationError(`${contextLabel} admite como máximo dos decimales.`);
  }
}

/**
 * Valida un precio de compra unitario:
 * - Numérico, finito.
 * - Mayor que cero.
 * - Máximo dos decimales.
 */
export function validatePurchasePrice(price: number): void {
  if (typeof price !== 'number' || !Number.isFinite(price)) {
    throw new ValidationError('El precio de compra debe ser un valor numérico válido.');
  }

  if (price <= 0) {
    throw new ValidationError('El precio de compra debe ser mayor que cero.');
  }

  const decimalsPart = (price.toString().split('.')[1] || '').length;
  if (decimalsPart > 2) {
    throw new ValidationError('El precio de compra admite como máximo dos decimales.');
  }
}

/**
 * Normaliza y valida el precio de venta:
 * - Obligatorio y numérico.
 * - Expresado en pesos enteros (si se introduce decimal, redondea hacia arriba al entero siguiente).
 * - Nunca puede ser inferior al precio de compra (se permite vender al costo).
 */
export function resolveSalePrice(inputSalePrice: number, unitPurchasePrice: number): number {
  if (typeof inputSalePrice !== 'number' || !Number.isFinite(inputSalePrice)) {
    throw new ValidationError('El precio de venta debe ser un valor numérico válido.');
  }

  if (inputSalePrice <= 0) {
    throw new ValidationError('El precio de venta debe ser mayor que cero.');
  }

  // Si se introduce un valor decimal, redondear hacia arriba al entero siguiente
  const integerSalePrice = Math.ceil(inputSalePrice);

  if (integerSalePrice < unitPurchasePrice) {
    throw new ValidationError(
      `El precio de venta ($${integerSalePrice}) no puede ser inferior al precio de compra ($${unitPurchasePrice.toFixed(2)}).`
    );
  }

  return integerSalePrice;
}

/**
 * Calcula el costo total de entrada evitando errores de punto flotante.
 * Estrategia de enteros escalados: multiplica centavos de compra por cantidad escalada.
 */
export function calculateTotalEntryCost(quantity: number, unitPurchasePrice: number): number {
  validateQuantity(quantity, 'La cantidad de entrada');
  validatePurchasePrice(unitPurchasePrice);

  // Multiplicamos usando enteros de centavos para evitar 0.1 * 0.2 = 0.020000000000000004
  const quantityHundredths = Math.round(quantity * 100);
  const purchasePriceCents = Math.round(unitPurchasePrice * 100);

  const totalCents = Math.round((quantityHundredths * purchasePriceCents) / 100);
  return totalCents / 100;
}

/**
 * Calcula el porcentaje de ganancia según la fórmula de negocio:
 * Ganancia (%) = ((Precio de venta / Precio de compra) - 1) × 100
 * Devuelve un número con 2 decimales de precisión.
 */
export function calculateProfitMarginPercentage(
  salePrice: number,
  purchasePrice: number
): number {
  if (purchasePrice <= 0) return 0;
  const raw = ((salePrice / purchasePrice) - 1) * 100;
  return Math.round(raw * 100) / 100;
}

export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}
