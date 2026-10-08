import type { DatosSesion, Equipo, PantallaPin, RespuestaSesion } from '../api/tipos';

// Sesiones de ejemplo para las pruebas: lo mismo que entrega la API en cada caso.

export const TABLET: Equipo = {
  id: '11111111-1111-4111-8111-111111111111',
  nombre: 'Tablet Las Américas',
  tipo: 'TABLET',
  caja_id: null,
  sucursal: { id: 1, codigo: 'LAM', nombre: 'Multicentro Las Américas' },
};

const VENDEDOR_COMPLETO = [
  'CAJA_ABRIR',
  'CAJA_CERRAR',
  'DEVOLUCIONES_REGISTRAR',
  'INVENTARIO_CONTAR',
  'INVENTARIO_RECIBIR',
  'INVENTARIO_REPORTAR_MERMA',
  'INVENTARIO_VER',
  'PRODUCTOS_VER',
  'VENTAS_MODIFICAR_PRECIO',
  'VENTAS_PROMOCION',
  'VENTAS_REGISTRAR',
  'VENTAS_VER_PROPIAS',
];

/** Lo que vale sin equipo registrado: sin la caja ni las mermas. */
const VENDEDOR_CELULAR = VENDEDOR_COMPLETO.filter(
  (p) => !['CAJA_ABRIR', 'CAJA_CERRAR', 'INVENTARIO_REPORTAR_MERMA'].includes(p),
);

export function sesionDeVendedora(donde: 'tablet' | 'celular'): DatosSesion {
  return {
    usuario: {
      id: 3,
      nombre_completo: 'Ana Martínez',
      username: 'ana.martinez',
      rol: { codigo: 'VENDEDOR', nombre: 'Vendedor' },
      debe_cambiar_password: false,
      permisos: donde === 'tablet' ? VENDEDOR_COMPLETO : VENDEDOR_CELULAR,
      sucursales: [TABLET.sucursal],
      pin: 'SIN_PIN',
    },
    equipo: donde === 'tablet' ? TABLET : null,
    acceso: donde === 'tablet' ? 'COMPLETO' : 'CELULAR',
    pantalla_bloqueo_minutos: 3,
  };
}

export function sesionDeAdmin(): DatosSesion {
  return {
    usuario: {
      id: 1,
      nombre_completo: 'Víctor Alcocer',
      username: 'admin',
      rol: { codigo: 'ADMIN', nombre: 'Administrador' },
      debe_cambiar_password: false,
      permisos: [
        'ALERTAS_VER',
        'CAJA_ABRIR',
        'CAJA_CERRAR',
        'DEVOLUCIONES_APROBAR',
        'INVENTARIO_AJUSTAR',
        'INVENTARIO_TRASLADAR',
        'PARAMETROS_GESTIONAR',
        'PRODUCTOS_GESTIONAR',
        'PRODUCTOS_VER',
        'REPORTES_VER',
        'SUCURSALES_GESTIONAR',
        'USUARIOS_VER',
        'VENTAS_REGISTRAR',
      ],
      sucursales: [],
      pin: 'SIN_PIN',
    },
    equipo: null,
    acceso: 'COMPLETO',
    pantalla_bloqueo_minutos: 3,
  };
}

export function respuestaDeSesion(sesion: DatosSesion): RespuestaSesion {
  return {
    ...sesion,
    access_token: 'token-de-prueba',
    token_type: 'Bearer',
    expira_en: 900,
    sesion_expira_at: '2026-10-09T04:00:00.000Z',
  };
}

export const SIN_EQUIPO: PantallaPin = { equipo: null, abierto: false, usuarios: [] };

export const TABLET_ABIERTA: PantallaPin = {
  equipo: TABLET,
  abierto: true,
  usuarios: [
    { id: 3, nombre_completo: 'Ana Martínez', pin_bloqueado: false },
    { id: 4, nombre_completo: 'María López', pin_bloqueado: true },
  ],
};
