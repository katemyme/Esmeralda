import {
  Bell,
  ChartColumn,
  ClipboardList,
  House,
  PackageX,
  Search,
  Settings,
  ShoppingCart,
  TabletSmartphone,
  Tags,
  Truck,
  Undo2,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { DatosSesion } from './api/tipos';
import { tienePermiso } from './sesion/sesion';

export interface OpcionMenu {
  ruta: string;
  titulo: string;
  icono: LucideIcon;
  /** Basta con tener uno (de los que valen en esta sesión). Vacío: la ve todo el mundo. */
  permisos: readonly string[];
  /** Fase en que se construye. Lo que no es de la fase actual sale marcado «Pronto». */
  fase: 'F1' | 'F2a1' | 'F2a2' | 'F2b' | 'F3' | 'F3b' | 'F4' | 'F5';
}

/** Hasta qué fase están hechas las pantallas. */
export const FASES_LISTAS: ReadonlySet<OpcionMenu['fase']> = new Set(['F1', 'F2a1']);

/**
 * El menú completo, en el orden en que se muestra. Cada quien ve solo lo que sus permisos le dan
 * en esta sesión: la API ya entrega los permisos recortados cuando se entra desde el celular, así
 * que el menú del celular sale más corto sin ninguna regla aparte.
 */
export const MENU: readonly OpcionMenu[] = [
  { ruta: '/', titulo: 'Inicio', icono: House, permisos: [], fase: 'F1' },
  {
    ruta: '/venta',
    titulo: 'Vender',
    icono: ShoppingCart,
    permisos: ['VENTAS_REGISTRAR'],
    fase: 'F2a2',
  },
  {
    ruta: '/caja',
    titulo: 'Caja',
    icono: Wallet,
    permisos: ['CAJA_ABRIR', 'CAJA_CERRAR', 'CAJA_VER_DIFERENCIAS'],
    fase: 'F2a1',
  },
  {
    ruta: '/consulta',
    titulo: 'Precios y existencias',
    icono: Search,
    permisos: ['PRODUCTOS_VER'],
    fase: 'F2a1',
  },
  {
    ruta: '/devoluciones',
    titulo: 'Devoluciones',
    icono: Undo2,
    permisos: ['DEVOLUCIONES_REGISTRAR', 'DEVOLUCIONES_APROBAR'],
    fase: 'F2b',
  },
  {
    ruta: '/envios',
    titulo: 'Envíos',
    icono: Truck,
    permisos: ['INVENTARIO_RECIBIR', 'INVENTARIO_TRASLADAR'],
    fase: 'F3',
  },
  {
    ruta: '/conteos',
    titulo: 'Conteos',
    icono: ClipboardList,
    permisos: ['INVENTARIO_CONTAR', 'INVENTARIO_AJUSTAR'],
    fase: 'F3',
  },
  {
    ruta: '/mermas',
    titulo: 'Mermas',
    icono: PackageX,
    permisos: ['INVENTARIO_REPORTAR_MERMA', 'INVENTARIO_AJUSTAR'],
    fase: 'F3',
  },
  {
    ruta: '/etiquetas',
    titulo: 'Etiquetas',
    icono: Tags,
    permisos: ['PRODUCTOS_GESTIONAR'],
    fase: 'F3b',
  },
  {
    ruta: '/administracion',
    titulo: 'Administración',
    icono: Settings,
    permisos: [
      'USUARIOS_VER',
      'PRODUCTOS_GESTIONAR',
      'PARAMETROS_GESTIONAR',
      'SUCURSALES_GESTIONAR',
    ],
    fase: 'F4',
  },
  {
    ruta: '/reportes',
    titulo: 'Reportes',
    icono: ChartColumn,
    permisos: ['REPORTES_VER'],
    fase: 'F5',
  },
  { ruta: '/alertas', titulo: 'Alertas', icono: Bell, permisos: [], fase: 'F1' },
  { ruta: '/equipo', titulo: 'Este equipo', icono: TabletSmartphone, permisos: [], fase: 'F1' },
];

export function opcionesPara(sesion: DatosSesion): OpcionMenu[] {
  return MENU.filter((opcion) => tienePermiso(sesion, opcion.permisos));
}

export function estaLista(opcion: OpcionMenu): boolean {
  return FASES_LISTAS.has(opcion.fase);
}
