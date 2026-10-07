import type { Reporte, TipoColumna, Valor } from '../reportes/reporte';
import { entero, fechaCorta, fechaHora, mesCorto, monto } from './formato';

/** Las líneas que van bajo el título de un reporte exportado: rango, sucursal, cuándo se generó y notas. */
export function lineasDeEncabezado(reporte: Reporte): string[] {
  const lineas: string[] = [];
  if (reporte.desde && reporte.hasta) {
    lineas.push(
      reporte.desde === reporte.hasta
        ? `Día: ${fechaCorta(reporte.desde)}`
        : `Del ${fechaCorta(reporte.desde)} al ${fechaCorta(reporte.hasta)}`,
    );
  }
  lineas.push(`Sucursal: ${reporte.sucursal?.nombre ?? 'todas'}`);
  lineas.push(`Generado el ${fechaHora(reporte.generado_at)}`);
  return [...lineas, ...reporte.notas];
}

/** Nombre del archivo de un reporte exportado: `ventas_2026-10-01_2026-10-07.xlsx`. */
export function nombreDeArchivo(reporte: Reporte, extension: 'xlsx' | 'pdf'): string {
  const rango =
    reporte.desde && reporte.hasta
      ? reporte.desde === reporte.hasta
        ? reporte.desde
        : `${reporte.desde}_${reporte.hasta}`
      : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Managua' }).format(
          reporte.generado_at,
        );
  return `${reporte.clave}_${rango}.${extension}`;
}

export function aInstante(valor: Valor): Date {
  return valor instanceof Date ? valor : new Date(String(valor));
}

/** El valor de una celda como se lee en un PDF. */
export function textoDeCelda(valor: Valor, tipo: TipoColumna): string {
  if (valor === null) return '';
  switch (tipo) {
    case 'entero':
      return entero(Number(valor));
    case 'monto':
      return monto(Number(valor));
    case 'porcentaje':
      return `${Number(valor).toFixed(1)} %`;
    case 'fecha':
      return fechaCorta(String(valor));
    case 'mes':
      return mesCorto(String(valor));
    case 'fecha_hora':
      return fechaHora(aInstante(valor));
    case 'si_no':
      return valor ? 'Sí' : 'No';
    default:
      return String(valor);
  }
}
