-- =====================================================================
--  ESMERALDA EXPERIENCE — Datos iniciales (catálogos, roles, permisos, admin)
--  Ejecutar después de 01_esquema.sql
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- Sucursales y cajas
-- ---------------------------------------------------------------------
INSERT INTO sucursal (codigo, nombre, tipo, direccion) VALUES
  ('LAM', 'Multicentro Las Américas', 'SUCURSAL', 'Multicentro Las Américas, Managua'),
  ('LBR', 'Multicentro Las Brisas',   'SUCURSAL', 'Multicentro Las Brisas, Managua'),
  ('BOD', 'Bodega central',           'BODEGA',   NULL);

-- Una caja por sucursal de venta (la bodega no tiene caja)
INSERT INTO caja (sucursal_id, nombre)
SELECT id, 'Caja 1' FROM sucursal WHERE tipo = 'SUCURSAL';

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
INSERT INTO permiso (codigo, modulo, descripcion) VALUES
  ('USUARIOS_VER',          'Usuarios',   'Ver listado de usuarios'),
  ('USUARIOS_GESTIONAR',    'Usuarios',   'Crear, editar, activar/desactivar y resetear contraseñas'),
  ('ROLES_GESTIONAR',       'Usuarios',   'Editar los permisos de cada rol'),
  ('SUCURSALES_GESTIONAR',  'Sucursales', 'Crear y editar sucursales y cajas'),
  ('SUCURSALES_TODAS',      'Sucursales', 'Operar y consultar en todas las sucursales'),
  ('PRODUCTOS_VER',         'Catálogo',   'Consultar productos y precios'),
  ('PRODUCTOS_GESTIONAR',   'Catálogo',   'Crear y editar productos, variantes y categorías'),
  ('PRECIOS_EDITAR',        'Catálogo',   'Cambiar precios de venta y costos'),
  ('INVENTARIO_VER',        'Inventario', 'Consultar stock y kardex'),
  ('INVENTARIO_VER_BODEGA', 'Inventario', 'Ver la cantidad exacta en bodega (sin él: según parámetro BODEGA_VISIBILIDAD)'),
  ('INVENTARIO_ENTRADA',    'Inventario', 'Registrar compras y entradas de mercadería; gestionar proveedores'),
  ('ALERTAS_VER',           'Sistema',    'Ver y atender alertas (margen bajo, diferencias, caja sin cerrar)'),
  ('INVENTARIO_AJUSTAR',    'Inventario', 'Aprobar mermas, aplicar conteos y hacer ajustes de inventario'),
  ('INVENTARIO_TRASLADAR',  'Inventario', 'Crear y enviar envíos de mercadería entre ubicaciones'),
  ('INVENTARIO_RECIBIR',    'Inventario', 'Recibir envíos en su sucursal'),
  ('INVENTARIO_REPORTAR_MERMA','Inventario','Reportar piezas dañadas o perdidas (las aprueba el admin)'),
  ('INVENTARIO_CONTAR',     'Inventario', 'Hacer conteos físicos con la tablet'),
  ('VENTAS_REGISTRAR',      'Ventas',     'Registrar ventas en el POS'),
  ('VENTAS_VER_PROPIAS',    'Ventas',     'Ver sus propias ventas'),
  ('VENTAS_VER_TODAS',      'Ventas',     'Ver ventas de todos los vendedores'),
  ('VENTAS_PROMOCION',      'Ventas',     'Aplicar a una venta una promoción activa y vigente'),
  ('PROMOCIONES_GESTIONAR', 'Ventas',     'Crear, editar, activar y desactivar promociones'),
  ('VENTAS_MODIFICAR_PRECIO','Ventas',    'Cobrar por encima del precio establecido (nunca por debajo)'),
  ('PARAMETROS_GESTIONAR',  'Sistema',    'Editar parámetros generales del sistema'),
  ('VENTAS_ANULAR',         'Ventas',     'Anular ventas del turno abierto'),
  ('DEVOLUCIONES_REGISTRAR','Ventas',     'Solicitar devoluciones y cambios de ventas de turnos cerrados, y ejecutar en caja los aprobados'),
  ('DEVOLUCIONES_APROBAR',  'Ventas',     'Aprobar o rechazar devoluciones, anotar sus transferencias y decidir qué categorías las admiten'),
  ('CAJA_ABRIR',            'Caja',       'Abrir turno de caja'),
  ('CAJA_CERRAR',           'Caja',       'Cerrar turno de caja (arqueo)'),
  ('CAJA_MOVIMIENTOS',      'Caja',       'Registrar ingresos/egresos de efectivo'),
  ('CAJA_VER_DIFERENCIAS',  'Caja',       'Ver montos esperados y diferencias del arqueo'),
  ('CAJA_CIERRE_FORZADO',   'Caja',       'Cerrar un turno que nadie cerró (sin arqueo)'),
  ('TIPO_CAMBIO_GESTIONAR', 'Caja',       'Registrar el tipo de cambio del día'),
  ('REPORTES_VER',          'Reportes',   'Ver reportes de ventas'),
  ('REPORTES_COSTOS',       'Reportes',   'Ver costos, márgenes e inventario valorizado'),
  ('AUDITORIA_VER',         'Auditoría',  'Consultar bitácora de cambios y accesos');

-- Lo que una trabajadora puede hacer desde su celular (sin equipo registrado): consultar productos,
-- precios y existencias, recibir envíos, contar, solicitar devoluciones y vender (la venta entra al
-- turno abierto de su sucursal). Todo lo demás —y todo lo de caja— es de la tablet de la sucursal.
UPDATE permiso SET sin_equipo = true
 WHERE codigo IN ('PRODUCTOS_VER','INVENTARIO_VER','INVENTARIO_RECIBIR','INVENTARIO_CONTAR','DEVOLUCIONES_REGISTRAR',
                  'VENTAS_REGISTRAR','VENTAS_VER_PROPIAS','VENTAS_PROMOCION','VENTAS_MODIFICAR_PRECIO');

-- ---------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------
INSERT INTO rol (codigo, nombre, descripcion, es_sistema) VALUES
  ('ADMIN',     'Administrador',         'Acceso total al sistema y al panel de administración', true),
  ('ENCARGADO', 'Encargado de sucursal', 'Gestiona inventario, caja y ventas de su sucursal',    true),
  ('VENDEDOR',  'Vendedor',              'Registra ventas y abre/cierra su caja',                true);

-- ADMIN: todos (fn_tiene_permiso ya se lo concede; se registran para mostrarlos en el panel)
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r CROSS JOIN permiso p WHERE r.codigo = 'ADMIN';

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo IN (
  'PRODUCTOS_VER','INVENTARIO_VER','INVENTARIO_RECIBIR','INVENTARIO_REPORTAR_MERMA','INVENTARIO_CONTAR',
  'VENTAS_REGISTRAR','VENTAS_VER_PROPIAS','VENTAS_VER_TODAS','VENTAS_PROMOCION','VENTAS_ANULAR',
  'VENTAS_MODIFICAR_PRECIO','DEVOLUCIONES_REGISTRAR',
  'CAJA_ABRIR','CAJA_CERRAR','CAJA_MOVIMIENTOS','CAJA_VER_DIFERENCIAS','TIPO_CAMBIO_GESTIONAR',
  'REPORTES_VER')
WHERE r.codigo = 'ENCARGADO';

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo IN (
  'PRODUCTOS_VER','INVENTARIO_VER','INVENTARIO_RECIBIR','INVENTARIO_REPORTAR_MERMA','INVENTARIO_CONTAR',
  'VENTAS_REGISTRAR','VENTAS_VER_PROPIAS','VENTAS_MODIFICAR_PRECIO','VENTAS_PROMOCION','DEVOLUCIONES_REGISTRAR',
  'CAJA_ABRIR','CAJA_CERRAR')
WHERE r.codigo = 'VENDEDOR';

-- ---------------------------------------------------------------------
-- Métodos de pago
-- ---------------------------------------------------------------------
INSERT INTO metodo_pago (codigo, nombre, es_efectivo, requiere_referencia) VALUES
  ('EFECTIVO',      'Efectivo',      true,  false),
  ('TARJETA',       'Tarjeta',       false, true),
  ('TRANSFERENCIA', 'Transferencia', false, true);

-- Método interno: lo devuelto en un cambio, aplicado a la venta nueva. No se elige al cobrar ni se
-- cuenta en el arqueo (no es dinero que entre a la caja).
INSERT INTO metodo_pago (codigo, nombre, es_efectivo, requiere_referencia, interno) VALUES
  ('SALDO_CAMBIO', 'Saldo por cambio', false, false, true);

-- ---------------------------------------------------------------------
-- Billetes y monedas para el conteo del cierre de caja
-- ---------------------------------------------------------------------
INSERT INTO denominacion (moneda, valor, tipo)
SELECT 'NIO', v, 'BILLETE' FROM unnest(ARRAY[10, 20, 50, 100, 200, 500, 1000]) v
UNION ALL SELECT 'NIO', v, 'MONEDA' FROM unnest(ARRAY[0.05, 0.10, 0.25, 0.50, 1, 5, 10]) v
UNION ALL SELECT 'USD', v, 'BILLETE' FROM unnest(ARRAY[1, 2, 5, 10, 20, 50, 100]) v
UNION ALL SELECT 'USD', v, 'MONEDA' FROM unnest(ARRAY[0.01, 0.05, 0.10, 0.25, 0.50, 1]) v;

-- ---------------------------------------------------------------------
-- Parámetros
-- ---------------------------------------------------------------------
--   minimo: valor más bajo que se acepta (solo números). Una sesión de 0 horas se cerraría sola al instante.
INSERT INTO parametro (clave, valor, tipo_valor, opciones, permite_vacio, minimo, descripcion) VALUES
  ('VENTA_SOBREPRECIO_MAX_PCT', '50', 'NUMERO', NULL, true, NULL,
   'Aumento máximo (%) que se puede cobrar sobre el precio establecido. Vacío = sin límite. Nunca se permite cobrar menos.'),
  ('MARGEN_MINIMO_ALERTA_PCT', '40', 'NUMERO', NULL, false, NULL,
   'Si una compra deja el margen de un producto por debajo de este %, se alerta al administrador.'),
  ('CAJA_TOLERANCIA_DIFERENCIA_NIO', '100', 'NUMERO', NULL, false, NULL,
   'Diferencia de arqueo (en C$, dólares convertidos) a partir de la cual se exige justificación y se alerta.'),
  ('CAJA_HORA_ALERTA_CIERRE', '21:30', 'HORA', NULL, false, NULL,
   'Hora (Managua) a la que se alerta si una caja sigue sin cerrar.'),
  ('TIPO_CAMBIO_VARIACION_MAX', '5', 'NUMERO', NULL, false, NULL,
   'Variación máxima (%) entre el tipo de cambio que se registra y el último registrado. Si se pasa, se pide confirmarlo.'),
  ('BODEGA_VISIBILIDAD', 'SI_NO', 'OPCION', ARRAY['SI_NO','CANTIDAD'], false, NULL,
   'Qué ven del stock de bodega los usuarios sin permiso INVENTARIO_VER_BODEGA: SI_NO = solo disponible sí/no; CANTIDAD = cantidad exacta.'),
  ('SESION_HORAS_EQUIPO', '12', 'NUMERO', NULL, false, 1,
   'Horas que dura una sesión iniciada en un equipo registrado (caja, tablet); luego se pide usuario y contraseña de nuevo.'),
  ('SESION_DIAS_SIN_EQUIPO', '7', 'NUMERO', NULL, false, 1,
   'Días que dura la sesión del administrador iniciada fuera de un equipo registrado.'),
  ('SESION_HORAS_CELULAR', '12', 'NUMERO', NULL, false, 1,
   'Horas que dura la sesión de una encargada o vendedora iniciada desde su celular (sin equipo registrado).'),
  ('NEGOCIO_NOMBRE', 'Esmeralda Experience', 'TEXTO', NULL, false, NULL,
   'Nombre del negocio en el encabezado del ticket de venta.'),
  ('NEGOCIO_RUC', NULL, 'TEXTO', NULL, true, NULL,
   'Número RUC que sale en el ticket de venta. Vacío = no se imprime.'),
  ('TICKET_LEYENDA', NULL, 'TEXTO', NULL, true, NULL,
   'Texto al pie del ticket de venta (p. ej. la política de cambios). Vacío = sin leyenda.'),
  ('DEVOLUCION_DIAS_MAX', '7', 'NUMERO', NULL, false, 1,
   'Días después de la venta en que todavía se puede solicitar una devolución o un cambio.'),
  ('DEVOLUCION_APROBADA_DIAS', '3', 'NUMERO', NULL, false, 1,
   'Días que tiene una devolución aprobada para ejecutarse en caja; después se cancela sola.');

-- ---------------------------------------------------------------------
-- Gamas de pieza para paquetes de perforación
--   TABLA = precio fijo por perforación · PIEZA = servicio + precio de la pieza
-- ---------------------------------------------------------------------
INSERT INTO gama (nombre, modo_precio, orden) VALUES
  ('Acero clásica', 'TABLA', 1),
  ('Acero de lujo', 'TABLA', 2),
  ('Titanio',       'PIEZA', 3);

-- ---------------------------------------------------------------------
-- Categorías (rubros de Esmeralda)
--   admite_devolucion: las piezas de piercing y las perforaciones nunca se devuelven ni se cambian;
--   joyería, accesorios, perfumería y cuidado posterior, sí (lo cambia el administrador en el panel).
-- ---------------------------------------------------------------------
INSERT INTO categoria (nombre, descripcion, admite_devolucion) VALUES
  ('Perforaciones',        'Servicios de perforación (no manejan inventario)', false),
  ('Piercing titanio',     'Joyería de titanio ASTM F-136',                    false),
  ('Piercing acero',       'Joyería de acero quirúrgico y de diseño',          false),
  ('Piercing bioflex',     'Joyería de bioflex',                               false),
  ('Cuidado posterior',    'NeilMed Piercing Aftercare y otros',               true),
  ('Joyería plata 925',    'Plata 925',                                        true),
  ('Joyería xuping',       'Xuping',                                           true),
  ('Joyería estilo Dubái', 'Estilo Dubái',                                     true),
  ('Accesorios dama',      'Accesorios para dama',                             true),
  ('Accesorios caballero', 'Accesorios para caballero',                        true),
  ('Perfumería',           'Perfumes',                                         true);

-- ---------------------------------------------------------------------
-- Administrador inicial
--   usuario:    admin
--   contraseña: Esmeralda#2026   ← TEMPORAL, el sistema obliga a cambiarla al primer login
--   Hash bcrypt ($2a$, costo 12) compatible con bcrypt/bcryptjs de Node.
-- ---------------------------------------------------------------------
INSERT INTO usuario (nombre_completo, username, password_hash, rol_id, debe_cambiar_password)
SELECT 'Administrador', 'admin', crypt('Esmeralda#2026', gen_salt('bf', 12)), r.id, true
  FROM rol r WHERE r.codigo = 'ADMIN';

COMMIT;
