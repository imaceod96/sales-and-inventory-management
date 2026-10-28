/**
 * Normaliza nombres para comparación y unicidad en dominio y almacenamiento.
 * - Elimina espacios en blanco al inicio y final.
 * - Colapsa múltiples espacios internos en uno solo.
 * - Convierte a minúsculas para ignorar diferencias entre mayúsculas y minúsculas.
 */
export function normalizeName(value: string): string {
  if (!value) return '';
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
