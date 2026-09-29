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
  ('INVENTARIO_AJUSTAR',    'Inventario', 'Ajustes de inventario y mermas'),
  ('INVENTARIO_TRASLADAR',  'Inventario', 'Trasladar stock entre sucursales'),
  ('VENTAS_REGISTRAR',      'Ventas',     'Registrar ventas en el POS'),
  ('VENTAS_VER_PROPIAS',    'Ventas',     'Ver sus propias ventas'),
  ('VENTAS_VER_TODAS',      'Ventas',     'Ver ventas de todos los vendedores'),
  ('VENTAS_DESCUENTO',      'Ventas',     'Aplicar descuentos'),
  ('VENTAS_MODIFICAR_PRECIO','Ventas',    'Cobrar por encima del precio establecido (nunca por debajo)'),
  ('PARAMETROS_GESTIONAR',  'Sistema',    'Editar parámetros generales del sistema'),
  ('VENTAS_ANULAR',         'Ventas',     'Anular ventas del turno abierto'),
  ('CAJA_ABRIR',            'Caja',       'Abrir turno de caja'),
  ('CAJA_CERRAR',           'Caja',       'Cerrar turno de caja (arqueo)'),
  ('CAJA_MOVIMIENTOS',      'Caja',       'Registrar ingresos/egresos de efectivo'),
  ('CAJA_VER_DIFERENCIAS',  'Caja',       'Ver montos esperados y diferencias del arqueo'),
  ('TIPO_CAMBIO_GESTIONAR', 'Caja',       'Registrar el tipo de cambio del día'),
  ('REPORTES_VER',          'Reportes',   'Ver reportes de ventas'),
  ('REPORTES_COSTOS',       'Reportes',   'Ver costos, márgenes e inventario valorizado'),
  ('AUDITORIA_VER',         'Auditoría',  'Consultar bitácora de cambios y accesos');

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
  'PRODUCTOS_VER','INVENTARIO_VER','INVENTARIO_AJUSTAR','INVENTARIO_TRASLADAR',
  'VENTAS_REGISTRAR','VENTAS_VER_PROPIAS','VENTAS_VER_TODAS','VENTAS_DESCUENTO','VENTAS_ANULAR',
  'VENTAS_MODIFICAR_PRECIO',
  'CAJA_ABRIR','CAJA_CERRAR','CAJA_MOVIMIENTOS','CAJA_VER_DIFERENCIAS','TIPO_CAMBIO_GESTIONAR',
  'REPORTES_VER')
WHERE r.codigo = 'ENCARGADO';

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo IN (
  'PRODUCTOS_VER','INVENTARIO_VER','VENTAS_REGISTRAR','VENTAS_VER_PROPIAS','VENTAS_MODIFICAR_PRECIO',
  'CAJA_ABRIR','CAJA_CERRAR')
WHERE r.codigo = 'VENDEDOR';

-- ---------------------------------------------------------------------
-- Métodos de pago
-- ---------------------------------------------------------------------
INSERT INTO metodo_pago (codigo, nombre, es_efectivo, requiere_referencia) VALUES
  ('EFECTIVO',      'Efectivo',      true,  false),
  ('TARJETA',       'Tarjeta',       false, true),
  ('TRANSFERENCIA', 'Transferencia', false, true);

-- ---------------------------------------------------------------------
-- Parámetros
-- ---------------------------------------------------------------------
INSERT INTO parametro (clave, valor, tipo_valor, opciones, permite_vacio, descripcion) VALUES
  ('VENTA_SOBREPRECIO_MAX_PCT', '50', 'NUMERO', NULL, true,
   'Aumento máximo (%) que se puede cobrar sobre el precio establecido. Vacío = sin límite. Nunca se permite cobrar menos.'),
  ('MARGEN_MINIMO_ALERTA_PCT', '40', 'NUMERO', NULL, false,
   'Si una compra deja el margen de un producto por debajo de este %, se alerta al administrador.'),
  ('CAJA_TOLERANCIA_DIFERENCIA_NIO', '100', 'NUMERO', NULL, false,
   'Diferencia de arqueo (en C$, dólares convertidos) a partir de la cual se exige justificación y se alerta.'),
  ('CAJA_HORA_ALERTA_CIERRE', '21:30', 'HORA', NULL, false,
   'Hora (Managua) a la que se alerta si una caja sigue sin cerrar.'),
  ('BODEGA_VISIBILIDAD', 'SI_NO', 'OPCION', ARRAY['SI_NO','CANTIDAD'], false,
   'Qué ven del stock de bodega los usuarios sin permiso INVENTARIO_VER_BODEGA: SI_NO = solo disponible sí/no; CANTIDAD = cantidad exacta.');

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
-- ---------------------------------------------------------------------
INSERT INTO categoria (nombre, descripcion) VALUES
  ('Perforaciones',        'Servicios de perforación (no manejan inventario)'),
  ('Piercing titanio',     'Joyería de titanio ASTM F-136'),
  ('Piercing acero',       'Joyería de acero quirúrgico y de diseño'),
  ('Piercing bioflex',     'Joyería de bioflex'),
  ('Cuidado posterior',    'NeilMed Piercing Aftercare y otros'),
  ('Joyería plata 925',    'Plata 925'),
  ('Joyería xuping',       'Xuping'),
  ('Joyería estilo Dubái', 'Estilo Dubái'),
  ('Accesorios dama',      'Accesorios para dama'),
  ('Accesorios caballero', 'Accesorios para caballero'),
  ('Perfumería',           'Perfumes');

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
