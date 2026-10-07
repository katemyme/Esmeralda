import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
import { UsuarioActual } from '../autenticacion/decoradores';
import { RequierePermiso } from '../autenticacion/permisos';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import { reporteExcel } from '../exportacion/excel';
import { reportePdf } from '../exportacion/pdf';
import { nombreDeArchivo } from '../exportacion/reporte-texto';
import {
  esquemaInventarioValorizado,
  esquemaReporte,
  esquemaReporteActual,
  esquemaReporteProductos,
  esquemaReporteVentas,
  type FiltroInventarioValorizado,
  type FiltroReporte,
  type FiltroReporteActual,
  type FiltroReporteProductos,
  type FiltroReporteVentas,
} from './esquemas';
import type { Reporte } from './reporte';
import { ReportesService } from './reportes.service';

type Respuesta = { reporte: Reporte } | StreamableFile;

const TIPO_DE_ARCHIVO = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/** El reporte como JSON (`{ reporte }`) o como archivo para descargar, según `?formato=`. */
async function entregar(reporte: Reporte, formato: 'json' | 'xlsx' | 'pdf'): Promise<Respuesta> {
  if (formato === 'json') return { reporte };
  const contenido = formato === 'xlsx' ? await reporteExcel(reporte) : await reportePdf(reporte);
  return new StreamableFile(contenido, {
    type: TIPO_DE_ARCHIVO[formato],
    disposition: `attachment; filename="${nombreDeArchivo(reporte, formato)}"`,
    length: contenido.length,
  });
}

/**
 * /api/reportes — todos responden lo mismo: `{ reporte: { titulo, desde, hasta, sucursal, notas,
 * secciones: [{ titulo, columnas, filas, totales }] } }`, o el archivo con `?formato=xlsx|pdf`.
 *
 * Los de un rango de días aceptan `?periodo=dia|semana|mes&fecha=` (el diario, el semanal de lunes
 * a domingo y el mensual; por defecto el día de hoy) o `?desde=&hasta=`, y `?sucursal_id=`.
 * Cada quien ve lo de sus sucursales; el costo y el margen solo salen con REPORTES_COSTOS, y sin
 * CAJA_VER_DIFERENCIAS las ventas de un turno todavía abierto no entran (arqueo ciego).
 */
@Controller('reportes')
export class ReportesController {
  constructor(private readonly reportes: ReportesService) {}

  /** Además `?agrupar=dia|semana|mes`: una fila por día, por semana o por mes del rango. */
  @Get('ventas')
  @RequierePermiso('REPORTES_VER')
  async ventas(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaReporteVentas)) filtro: FiltroReporteVentas,
  ): Promise<Respuesta> {
    return entregar(await this.reportes.ventas(usuario.id, filtro), filtro.formato);
  }

  @Get('ventas-por-vendedor')
  @RequierePermiso('REPORTES_VER')
  async ventasPorVendedor(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaReporte)) filtro: FiltroReporte,
  ): Promise<Respuesta> {
    return entregar(await this.reportes.ventasPorVendedor(usuario.id, filtro), filtro.formato);
  }

  @Get('ventas-por-sucursal')
  @RequierePermiso('REPORTES_VER')
  async ventasPorSucursal(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaReporte)) filtro: FiltroReporte,
  ): Promise<Respuesta> {
    return entregar(await this.reportes.ventasPorSucursal(usuario.id, filtro), filtro.formato);
  }

  /** Lo cobrado por método de pago y moneda (el vuelto ya restado del efectivo). */
  @Get('cobros')
  @RequierePermiso('REPORTES_VER')
  async cobros(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaReporte)) filtro: FiltroReporte,
  ): Promise<Respuesta> {
    return entregar(await this.reportes.cobros(usuario.id, filtro), filtro.formato);
  }

  /** Los más vendidos; además `?limite=` (por defecto 20). */
  @Get('productos')
  @RequierePermiso('REPORTES_VER')
  async productos(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaReporteProductos)) filtro: FiltroReporteProductos,
  ): Promise<Respuesta> {
    return entregar(await this.reportes.productos(usuario.id, filtro), filtro.formato);
  }

  /** Cada perforación: con pieza (paquete) contra solo servicio. */
  @Get('perforaciones')
  @RequierePermiso('REPORTES_VER')
  async perforaciones(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaReporte)) filtro: FiltroReporte,
  ): Promise<Respuesta> {
    return entregar(await this.reportes.perforaciones(usuario.id, filtro), filtro.formato);
  }

  /** Paquetes vendidos según la gama de la pieza. */
  @Get('gamas')
  @RequierePermiso('REPORTES_VER')
  async gamas(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaReporte)) filtro: FiltroReporte,
  ): Promise<Respuesta> {
    return entregar(await this.reportes.gamas(usuario.id, filtro), filtro.formato);
  }

  @Get('promociones')
  @RequierePermiso('REPORTES_VER')
  async promociones(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaReporte)) filtro: FiltroReporte,
  ): Promise<Respuesta> {
    return entregar(await this.reportes.promociones(usuario.id, filtro), filtro.formato);
  }

  /** Las líneas cobradas por encima del precio establecido. */
  @Get('sobreprecios')
  @RequierePermiso('REPORTES_VER')
  async sobreprecios(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaReporte)) filtro: FiltroReporte,
  ): Promise<Respuesta> {
    return entregar(await this.reportes.sobreprecios(usuario.id, filtro), filtro.formato);
  }

  /** Los turnos cerrados en el rango, con lo esperado, lo contado y las diferencias. */
  @Get('cierres')
  @RequierePermiso('CAJA_VER_DIFERENCIAS')
  async cierres(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaReporte)) filtro: FiltroReporte,
  ): Promise<Respuesta> {
    return entregar(await this.reportes.cierres(usuario.id, filtro), filtro.formato);
  }

  /** Mermas aprobadas en el rango; las pendientes y las rechazadas, aparte. */
  @Get('mermas')
  @RequierePermiso('REPORTES_VER')
  async mermas(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaReporte)) filtro: FiltroReporte,
  ): Promise<Respuesta> {
    return entregar(await this.reportes.mermas(usuario.id, filtro), filtro.formato);
  }

  /** Los meses (`AAAA-MM`) que tienen foto del cierre, para elegir `?mes=`. */
  @Get('inventario-valorizado/meses')
  @RequierePermiso('REPORTES_COSTOS')
  async mesesConFoto(): Promise<{ meses: string[] }> {
    return { meses: await this.reportes.mesesConFoto() };
  }

  /** El inventario valorizado de hoy o, con `?mes=AAAA-MM`, la foto del cierre de ese mes. */
  @Get('inventario-valorizado')
  @RequierePermiso('REPORTES_COSTOS')
  async inventarioValorizado(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaInventarioValorizado)) filtro: FiltroInventarioValorizado,
  ): Promise<Respuesta> {
    return entregar(await this.reportes.inventarioValorizado(usuario.id, filtro), filtro.formato);
  }

  /** Lo que está en su stock mínimo o por debajo (una foto de este momento). */
  @Get('por-reponer')
  @RequierePermiso('REPORTES_VER')
  async porReponer(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaReporteActual)) filtro: FiltroReporteActual,
  ): Promise<Respuesta> {
    return entregar(await this.reportes.porReponer(usuario.id, filtro), filtro.formato);
  }
}
