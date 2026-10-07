-- =====================================================================
--  ESMERALDA EXPERIENCE — Sistema de Inventario, Ventas y Caja
--  PostgreSQL 16  ·  Esquema v1.1  ·  2 sucursales + bodega central
--
--  Orden de ejecución:  01_esquema.sql  →  02_seed.sql  →  (03_datos_demo.sql)
--
--  Convenciones
--   · Moneda base: córdobas (NIO). Los pagos pueden ser en NIO o USD.
--   · Fechas en timestamptz; los reportes convierten a America/Managua.
--   · El backend debe ejecutar, dentro de cada transacción:
--        SET LOCAL app.usuario_id = '<id del usuario autenticado>';
--     para que la auditoría sepa quién hizo cada cambio.
--   · Las operaciones críticas (venta, anulación, ajustes, cierre) se hacen
--     SIEMPRE mediante las funciones fn_* — validan permisos y reglas.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid(), crypt() para el seed
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- búsqueda rápida de productos en el POS

-- ---------------------------------------------------------------------
-- 0. Utilidades
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_usuario_actual() RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.usuario_id', true), '')::bigint
$$;

CREATE OR REPLACE FUNCTION fn_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fn_bloquear_modificacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es de solo inserción: no se permite % (use los movimientos o la anulación)',
        TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
END $$;

-- =====================================================================
-- 1. ORGANIZACIÓN: sucursales y cajas
-- =====================================================================
-- Ubicaciones físicas. tipo SUCURSAL = vende y tiene cajas; tipo BODEGA = solo guarda stock
-- (la bodega central es donde entra toda la mercadería comprada).
CREATE TABLE sucursal (
  id                   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo               varchar(5)   NOT NULL UNIQUE CHECK (codigo ~ '^[A-Z]{2,5}$'),  -- prefijo de facturas
  nombre               varchar(80)  NOT NULL UNIQUE,
  tipo                 varchar(10)  NOT NULL DEFAULT 'SUCURSAL' CHECK (tipo IN ('SUCURSAL','BODEGA')),
  direccion            varchar(200),
  telefono             varchar(20),
  activa               boolean      NOT NULL DEFAULT true,
  ultimo_numero_venta  integer      NOT NULL DEFAULT 0,   -- correlativo sin huecos por sucursal
  created_at           timestamptz  NOT NULL DEFAULT now(),
  updated_at           timestamptz  NOT NULL DEFAULT now()
);

-- Solo puede existir una bodega central
CREATE UNIQUE INDEX ux_sucursal_una_bodega ON sucursal (tipo) WHERE tipo = 'BODEGA';

CREATE TABLE caja (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sucursal_id  integer     NOT NULL REFERENCES sucursal(id),
  nombre       varchar(40) NOT NULL,
  activa       boolean     NOT NULL DEFAULT true,
  UNIQUE (sucursal_id, nombre)
);

-- La bodega no vende: no puede tener cajas
CREATE OR REPLACE FUNCTION fn_validar_caja_sucursal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT tipo FROM sucursal WHERE id = NEW.sucursal_id) <> 'SUCURSAL' THEN
    RAISE EXCEPTION 'Solo las sucursales de venta pueden tener cajas (la bodega no vende)';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_caja_sucursal BEFORE INSERT OR UPDATE OF sucursal_id ON caja
  FOR EACH ROW EXECUTE FUNCTION fn_validar_caja_sucursal();

CREATE OR REPLACE FUNCTION fn_proteger_tipo_sucursal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tipo = 'BODEGA' AND EXISTS (SELECT 1 FROM caja WHERE sucursal_id = NEW.id) THEN
    RAISE EXCEPTION 'Una ubicación con cajas no puede convertirse en bodega';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_sucursal_tipo BEFORE UPDATE OF tipo ON sucursal
  FOR EACH ROW EXECUTE FUNCTION fn_proteger_tipo_sucursal();

-- =====================================================================
-- 2. SEGURIDAD: roles, permisos, usuarios, sesiones (panel de administración)
-- =====================================================================
CREATE TABLE rol (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo       varchar(20)  NOT NULL UNIQUE CHECK (codigo ~ '^[A-Z_]+$'),
  nombre       varchar(60)  NOT NULL,
  descripcion  varchar(200),
  es_sistema   boolean      NOT NULL DEFAULT false   -- los roles de sistema no se pueden eliminar
);

CREATE TABLE permiso (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo       varchar(40)  NOT NULL UNIQUE CHECK (codigo ~ '^[A-Z_]+$'),
  modulo       varchar(30)  NOT NULL,
  descripcion  varchar(200) NOT NULL
);

CREATE TABLE rol_permiso (
  rol_id      integer NOT NULL REFERENCES rol(id) ON DELETE CASCADE,
  permiso_id  integer NOT NULL REFERENCES permiso(id) ON DELETE CASCADE,
  PRIMARY KEY (rol_id, permiso_id)
);

CREATE TABLE usuario (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre_completo          varchar(120) NOT NULL,
  username                 varchar(40)  NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9._]{3,40}$'),
  email                    varchar(120),
  telefono                 varchar(20),
  password_hash            varchar(255) NOT NULL,          -- argon2id / bcrypt, NUNCA texto plano
  rol_id                   integer      NOT NULL REFERENCES rol(id),
  activo                   boolean      NOT NULL DEFAULT true,
  debe_cambiar_password    boolean      NOT NULL DEFAULT true,
  intentos_fallidos        smallint     NOT NULL DEFAULT 0,
  bloqueado_hasta          timestamptz,
  ultimo_acceso            timestamptz,
  password_actualizado_at  timestamptz  NOT NULL DEFAULT now(),
  created_by               bigint       REFERENCES usuario(id),
  created_at               timestamptz  NOT NULL DEFAULT now(),
  updated_at               timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_usuario_email ON usuario (lower(email)) WHERE email IS NOT NULL;

-- Sucursales en las que un usuario puede operar (el permiso SUCURSALES_TODAS las cubre todas)
CREATE TABLE usuario_sucursal (
  usuario_id   bigint  NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  sucursal_id  integer NOT NULL REFERENCES sucursal(id),
  PRIMARY KEY (usuario_id, sucursal_id)
);

-- Equipos autorizados (PC de caja, tablet de sucursal, celular del admin).
-- Cada equipo se registra una vez y queda ligado a su ubicación (y a su caja si es una PC de caja).
CREATE TABLE dispositivo (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          varchar(60)  NOT NULL,                       -- "Caja 1 Las Américas", "Tablet Las Brisas"
  tipo            varchar(10)  NOT NULL CHECK (tipo IN ('CAJA','TABLET','MOVIL')),
  sucursal_id     integer      NOT NULL REFERENCES sucursal(id),
  caja_id         integer      REFERENCES caja(id),
  token_hash      char(64)     NOT NULL UNIQUE,                 -- SHA-256 del token del equipo
  activo          boolean      NOT NULL DEFAULT true,
  registrado_por  bigint       NOT NULL REFERENCES usuario(id),
  created_at      timestamptz  NOT NULL DEFAULT now(),
  ultimo_uso      timestamptz,
  CONSTRAINT ck_dispositivo_caja CHECK ((tipo = 'CAJA') = (caja_id IS NOT NULL))
);

CREATE OR REPLACE FUNCTION fn_validar_dispositivo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.caja_id IS NOT NULL
     AND (SELECT sucursal_id FROM caja WHERE id = NEW.caja_id) <> NEW.sucursal_id THEN
    RAISE EXCEPTION 'La caja % no pertenece a la ubicación del equipo', NEW.caja_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_dispositivo_validar BEFORE INSERT OR UPDATE ON dispositivo
  FOR EACH ROW EXECUTE FUNCTION fn_validar_dispositivo();

-- Sesiones (refresh tokens rotativos). Permite al admin "cerrar sesión" a un usuario.
-- Al renovar, la sesión se revoca y apunta a la que la reemplaza (mismo vencimiento).
CREATE TABLE sesion (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id          bigint      NOT NULL REFERENCES usuario(id),
  dispositivo_id      uuid        REFERENCES dispositivo(id),  -- equipo donde se inició (NULL = sin equipo: solo el admin)
  refresh_token_hash  char(64)    NOT NULL UNIQUE,     -- SHA-256 del token, nunca el token
  ip                  inet,
  user_agent          varchar(300),
  creada_at           timestamptz NOT NULL DEFAULT now(),
  expira_at           timestamptz NOT NULL,
  revocada_at         timestamptz,
  reemplazada_por     uuid        REFERENCES sesion(id)        -- renovación: la sesión que la sustituyó
);
CREATE INDEX ix_sesion_usuario_activa ON sesion (usuario_id) WHERE revocada_at IS NULL;
CREATE INDEX ix_sesion_dispositivo_activa ON sesion (dispositivo_id) WHERE revocada_at IS NULL;

-- Bitácora de inicios de sesión (exitosos y fallidos)
CREATE TABLE acceso_log (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id          bigint REFERENCES usuario(id),
  username_intentado  varchar(40) NOT NULL,
  exito               boolean     NOT NULL,
  motivo              varchar(60),
  ip                  inet,
  user_agent          varchar(300),
  dispositivo_id      uuid        REFERENCES dispositivo(id),
  fecha               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_acceso_log_usuario_fecha ON acceso_log (usuario_id, fecha DESC);

-- Auditoría genérica de cambios en datos maestros
CREATE TABLE auditoria (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tabla        varchar(40) NOT NULL,
  registro_id  varchar(40),
  accion       varchar(6)  NOT NULL CHECK (accion IN ('INSERT','UPDATE','DELETE')),
  antes        jsonb,
  despues      jsonb,
  usuario_id   bigint REFERENCES usuario(id),
  fecha        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_auditoria_tabla_registro ON auditoria (tabla, registro_id);
CREATE INDEX ix_auditoria_fecha ON auditoria (fecha DESC);

-- =====================================================================
-- 3. CATÁLOGO: categorías, productos (y servicios), variantes
-- =====================================================================
CREATE TABLE categoria (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre       varchar(60)  NOT NULL UNIQUE,
  descripcion  varchar(200),
  activa       boolean      NOT NULL DEFAULT true,
  created_at   timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE producto (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  categoria_id  integer      NOT NULL REFERENCES categoria(id),
  nombre        varchar(120) NOT NULL,
  descripcion   varchar(500),
  tipo          varchar(10)  NOT NULL DEFAULT 'PRODUCTO' CHECK (tipo IN ('PRODUCTO','SERVICIO','PAQUETE')),
                -- PRODUCTO = pieza o artículo con stock · SERVICIO = perforación sola · PAQUETE = perforación con pieza incluida
  activo        boolean      NOT NULL DEFAULT true,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX ix_producto_categoria ON producto (categoria_id);
CREATE INDEX ix_producto_nombre_trgm ON producto USING gin (lower(nombre) gin_trgm_ops);

-- Lo que realmente se vende: material / calibre / largo / color.
-- Un producto sin variantes reales tiene UNA variante ("Única").
CREATE TABLE variante (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  producto_id    bigint        NOT NULL REFERENCES producto(id),
  sku            varchar(40)   NOT NULL UNIQUE,
  codigo_barras  varchar(40)   UNIQUE,
  nombre         varchar(120)  NOT NULL DEFAULT 'Única',   -- ej. "Titanio F-136 · 16G · 8 mm"
  atributos      jsonb         NOT NULL DEFAULT '{}'::jsonb, -- {"material":"titanio","calibre":"16G","largo_mm":8}
  precio_venta   numeric(12,2) NOT NULL CHECK (precio_venta >= 0),
  costo          numeric(12,2) NOT NULL DEFAULT 0 CHECK (costo >= 0),
  gama_id        integer,                                   -- solo piezas usables en paquetes (FK abajo)
  foto_url       varchar(300),                              -- foto del diseño para el POS y la tablet
  activo         boolean       NOT NULL DEFAULT true,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX ix_variante_producto ON variante (producto_id);
CREATE INDEX ix_variante_nombre_trgm ON variante USING gin (lower(nombre) gin_trgm_ops);

CREATE TABLE historial_precio (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variante_id      bigint        NOT NULL REFERENCES variante(id),
  precio_anterior  numeric(12,2) NOT NULL,
  precio_nuevo     numeric(12,2) NOT NULL,
  costo_anterior   numeric(12,2) NOT NULL,
  costo_nuevo      numeric(12,2) NOT NULL,
  usuario_id       bigint REFERENCES usuario(id),
  fecha            timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX ix_historial_precio_variante ON historial_precio (variante_id, fecha DESC);

-- ---------------------------------------------------------------------
-- 3.1 Perforaciones, gamas de pieza y precios de paquete
-- ---------------------------------------------------------------------
-- Gama de pieza. modo_precio:
--   TABLA = precio fijo por perforación (acero clásica, acero de lujo)
--   PIEZA = el paquete cuesta el servicio + el precio de la pieza (titanio, varía por diseño)
CREATE TABLE gama (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre       varchar(40)  NOT NULL UNIQUE,
  modo_precio  varchar(5)   NOT NULL CHECK (modo_precio IN ('TABLA','PIEZA')),
  orden        smallint     NOT NULL DEFAULT 0,
  activa       boolean      NOT NULL DEFAULT true
);

ALTER TABLE variante ADD CONSTRAINT fk_variante_gama FOREIGN KEY (gama_id) REFERENCES gama(id);
CREATE INDEX ix_variante_gama ON variante (gama_id) WHERE gama_id IS NOT NULL;

-- Tipo de perforación. Cada una tiene dos entradas en el catálogo, creadas por fn_crear_perforacion:
--   · servicio  (tipo SERVICIO): perforación sola; su precio_venta ES el precio de "solo servicio"
--   · paquete   (tipo PAQUETE):  perforación con pieza; su precio lo calcula fn_precio_paquete
CREATE TABLE perforacion (
  id                   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo               varchar(6)   NOT NULL UNIQUE CHECK (codigo ~ '^[A-Z]{2,6}$'),
  nombre               varchar(60)  NOT NULL UNIQUE,
  piezas_por_paquete   smallint     NOT NULL DEFAULT 1 CHECK (piezas_por_paquete BETWEEN 1 AND 4),
  servicio_variante_id bigint       NOT NULL UNIQUE REFERENCES variante(id),
  paquete_variante_id  bigint       NOT NULL UNIQUE REFERENCES variante(id),
  activa               boolean      NOT NULL DEFAULT true,
  created_at           timestamptz  NOT NULL DEFAULT now()
);

-- Qué piezas se pueden usar en el paquete de cada perforación (por gama, categoría o variante).
-- Sin reglas = cualquier pieza que tenga gama.
CREATE TABLE perforacion_pieza_permitida (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  perforacion_id  integer NOT NULL REFERENCES perforacion(id) ON DELETE CASCADE,
  gama_id         integer REFERENCES gama(id),
  categoria_id    integer REFERENCES categoria(id),
  variante_id     bigint  REFERENCES variante(id),
  CONSTRAINT ck_permitida_una_regla CHECK (num_nonnulls(gama_id, categoria_id, variante_id) = 1),
  CONSTRAINT ux_permitida UNIQUE NULLS NOT DISTINCT (perforacion_id, gama_id, categoria_id, variante_id)
);

-- Regla 2: precio del paquete por perforación × gama (solo gamas en modo TABLA)
CREATE TABLE precio_perforacion_gama (
  perforacion_id  integer       NOT NULL REFERENCES perforacion(id) ON DELETE CASCADE,
  gama_id         integer       NOT NULL REFERENCES gama(id),
  precio          numeric(12,2) NOT NULL CHECK (precio > 0),
  updated_by      bigint        REFERENCES usuario(id),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (perforacion_id, gama_id)
);

-- Regla 1: precios especiales (excepciones) para una perforación con una pieza o una gama concreta
CREATE TABLE precio_especial_paquete (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  perforacion_id  integer       NOT NULL REFERENCES perforacion(id) ON DELETE CASCADE,
  variante_id     bigint        REFERENCES variante(id),
  gama_id         integer       REFERENCES gama(id),
  precio          numeric(12,2) NOT NULL CHECK (precio > 0),
  motivo          varchar(200),
  created_by      bigint        REFERENCES usuario(id),
  created_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT ck_especial_objetivo CHECK (num_nonnulls(variante_id, gama_id) = 1),
  CONSTRAINT ux_especial UNIQUE NULLS NOT DISTINCT (perforacion_id, variante_id, gama_id)
);

-- Solo las piezas (tipo PRODUCTO) llevan gama; la tabla de precios solo acepta gamas en modo TABLA
CREATE OR REPLACE FUNCTION fn_validar_gama_variante() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.gama_id IS NOT NULL
     AND (SELECT tipo FROM producto WHERE id = NEW.producto_id) <> 'PRODUCTO' THEN
    RAISE EXCEPTION 'Solo las piezas (productos con stock) pueden tener gama';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_variante_gama BEFORE INSERT OR UPDATE OF gama_id, producto_id ON variante
  FOR EACH ROW EXECUTE FUNCTION fn_validar_gama_variante();

CREATE OR REPLACE FUNCTION fn_validar_precio_gama() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT modo_precio FROM gama WHERE id = NEW.gama_id) <> 'TABLA' THEN
    RAISE EXCEPTION 'La gama % tiene precio por pieza; no lleva precio en la tabla de perforaciones',
          (SELECT nombre FROM gama WHERE id = NEW.gama_id);
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER tg_precio_gama_validar BEFORE INSERT OR UPDATE ON precio_perforacion_gama
  FOR EACH ROW EXECUTE FUNCTION fn_validar_precio_gama();

-- =====================================================================
-- 4. INVENTARIO: stock por sucursal + kardex (movimientos)
-- =====================================================================
CREATE TABLE stock_sucursal (
  sucursal_id   integer     NOT NULL REFERENCES sucursal(id),
  variante_id   bigint      NOT NULL REFERENCES variante(id),
  cantidad      integer     NOT NULL DEFAULT 0 CHECK (cantidad >= 0),   -- nunca negativo
  stock_minimo  integer     NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sucursal_id, variante_id)
);

CREATE TABLE movimiento_inventario (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sucursal_id       integer      NOT NULL REFERENCES sucursal(id),
  variante_id       bigint       NOT NULL REFERENCES variante(id),
  tipo              varchar(20)  NOT NULL CHECK (tipo IN (
                       'ENTRADA','AJUSTE_POSITIVO','ANULACION_VENTA','TRASLADO_ENTRADA',
                       'VENTA','AJUSTE_NEGATIVO','MERMA','TRASLADO_SALIDA')),
  cantidad          integer      NOT NULL CHECK (cantidad <> 0),   -- con signo
  stock_resultante  integer      NOT NULL,                         -- lo llena el trigger
  costo_unitario    numeric(12,2),
  venta_id          bigint,                                        -- FK agregada tras crear venta
  envio_id          bigint,                                        -- envío que originó un traslado (FK abajo)
  motivo            varchar(200),
  usuario_id        bigint       NOT NULL REFERENCES usuario(id),
  fecha             timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT ck_mov_signo CHECK (
       (tipo IN ('ENTRADA','AJUSTE_POSITIVO','ANULACION_VENTA','TRASLADO_ENTRADA') AND cantidad > 0)
    OR (tipo IN ('VENTA','AJUSTE_NEGATIVO','MERMA','TRASLADO_SALIDA')              AND cantidad < 0)),
  CONSTRAINT ck_mov_motivo CHECK (
       tipo NOT IN ('AJUSTE_POSITIVO','AJUSTE_NEGATIVO','MERMA') OR length(trim(motivo)) >= 5),
  CONSTRAINT ck_mov_venta CHECK ((tipo IN ('VENTA','ANULACION_VENTA')) = (venta_id IS NOT NULL)),
  CONSTRAINT ck_mov_envio CHECK ((tipo IN ('TRASLADO_SALIDA','TRASLADO_ENTRADA')) = (envio_id IS NOT NULL))
);
CREATE INDEX ix_mov_variante_fecha ON movimiento_inventario (variante_id, fecha DESC);
CREATE INDEX ix_mov_sucursal_fecha ON movimiento_inventario (sucursal_id, fecha DESC);
CREATE INDEX ix_mov_venta ON movimiento_inventario (venta_id) WHERE venta_id IS NOT NULL;

-- Cada movimiento actualiza el stock atómicamente. Si quedara negativo → error.
CREATE OR REPLACE FUNCTION fn_aplicar_movimiento() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_tipo_producto varchar(10);
  v_nombre        text;
BEGIN
  SELECT p.tipo, p.nombre || ' — ' || v.nombre
    INTO v_tipo_producto, v_nombre
    FROM variante v JOIN producto p ON p.id = v.producto_id
   WHERE v.id = NEW.variante_id;

  IF v_tipo_producto IN ('SERVICIO','PAQUETE') THEN
    RAISE EXCEPTION 'Los servicios y paquetes no manejan inventario propio (%); se mueve la pieza', v_nombre;
  END IF;

  -- UPDATE atómico (bloquea la fila); el CHECK cantidad >= 0 impide la sobreventa
  BEGIN
    UPDATE stock_sucursal
       SET cantidad = cantidad + NEW.cantidad, updated_at = now()
     WHERE sucursal_id = NEW.sucursal_id AND variante_id = NEW.variante_id
    RETURNING cantidad INTO NEW.stock_resultante;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'Stock insuficiente de "%" en la sucursal % (se intentó mover %)',
          v_nombre, NEW.sucursal_id, NEW.cantidad
          USING ERRCODE = 'check_violation';
  END;

  IF NOT FOUND THEN                        -- primera vez que la variante entra a esta sucursal
    IF NEW.cantidad < 0 THEN
      RAISE EXCEPTION 'Stock insuficiente de "%" en la sucursal % (sin existencias)',
            v_nombre, NEW.sucursal_id
            USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO stock_sucursal AS s (sucursal_id, variante_id, cantidad)
    VALUES (NEW.sucursal_id, NEW.variante_id, NEW.cantidad)
    ON CONFLICT (sucursal_id, variante_id)              -- carrera con otra transacción
    DO UPDATE SET cantidad = s.cantidad + EXCLUDED.cantidad, updated_at = now()
    RETURNING cantidad INTO NEW.stock_resultante;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER tg_mov_aplicar BEFORE INSERT ON movimiento_inventario
  FOR EACH ROW EXECUTE FUNCTION fn_aplicar_movimiento();
CREATE TRIGGER tg_mov_inmutable BEFORE UPDATE OR DELETE ON movimiento_inventario
  FOR EACH ROW EXECUTE FUNCTION fn_bloquear_modificacion();

-- ---------------------------------------------------------------------
-- 4.1 Compras (solo el admin; siempre entran a la bodega central)
-- ---------------------------------------------------------------------
CREATE TABLE proveedor (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre           varchar(120) NOT NULL UNIQUE,
  pais             varchar(60),
  moneda_habitual  char(3)      NOT NULL DEFAULT 'USD' CHECK (moneda_habitual IN ('NIO','USD')),
  contacto         varchar(120),
  telefono         varchar(30),
  email            varchar(120),
  activo           boolean      NOT NULL DEFAULT true,
  created_at       timestamptz  NOT NULL DEFAULT now()
);

-- Una compra = una factura de proveedor. Se arma en BORRADOR y al CONFIRMAR entra el stock.
CREATE TABLE compra (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proveedor_id        integer       NOT NULL REFERENCES proveedor(id),
  factura_numero      varchar(40)   NOT NULL,
  fecha_factura       date          NOT NULL,
  moneda              char(3)       NOT NULL CHECK (moneda IN ('NIO','USD')),
  tipo_cambio         numeric(10,4) NOT NULL CHECK (tipo_cambio > 0),   -- 1 si es en córdobas
  sucursal_id         integer       NOT NULL REFERENCES sucursal(id),   -- siempre la bodega
  estado              varchar(10)   NOT NULL DEFAULT 'BORRADOR' CHECK (estado IN ('BORRADOR','CONFIRMADA','CANCELADA')),
  notas               varchar(500),
  created_by          bigint        NOT NULL REFERENCES usuario(id),
  created_at          timestamptz   NOT NULL DEFAULT now(),
  confirmada_por      bigint        REFERENCES usuario(id),
  fecha_confirmacion  timestamptz,
  CONSTRAINT ux_compra_factura UNIQUE (proveedor_id, factura_numero),
  CONSTRAINT ck_compra_tc CHECK (moneda = 'USD' OR tipo_cambio = 1),
  CONSTRAINT ck_compra_confirmada CHECK ((estado = 'CONFIRMADA') = (fecha_confirmacion IS NOT NULL))
);

CREATE TABLE compra_detalle (
  id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  compra_id                 bigint        NOT NULL REFERENCES compra(id) ON DELETE CASCADE,
  variante_id               bigint        NOT NULL REFERENCES variante(id),
  cantidad_facturada        integer       NOT NULL CHECK (cantidad_facturada > 0),
  cantidad_recibida         integer       NOT NULL CHECK (cantidad_recibida >= 0),
  costo_unitario_factura    numeric(12,4) NOT NULL CHECK (costo_unitario_factura >= 0),  -- en la moneda de la compra
  -- Se calculan al confirmar:
  gasto_asignado_nio        numeric(12,2),
  costo_unitario_final_nio  numeric(12,4),   -- (valor en C$ + gastos asignados) / cantidad facturada
  costo_promedio_nuevo      numeric(12,2),
  CONSTRAINT ux_compra_variante UNIQUE (compra_id, variante_id),
  CONSTRAINT ck_compra_recibida CHECK (cantidad_recibida <= cantidad_facturada)
);

CREATE TABLE compra_gasto (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  compra_id    bigint        NOT NULL REFERENCES compra(id) ON DELETE CASCADE,
  concepto     varchar(10)   NOT NULL CHECK (concepto IN ('COURIER','ADUANA','IMPUESTOS','FLETE','OTRO')),
  descripcion  varchar(200),
  moneda       char(3)       NOT NULL CHECK (moneda IN ('NIO','USD')),
  monto        numeric(12,2) NOT NULL CHECK (monto > 0),
  tipo_cambio  numeric(10,4) NOT NULL CHECK (tipo_cambio > 0),
  monto_nio    numeric(12,2) GENERATED ALWAYS AS
                 (round(CASE WHEN moneda = 'USD' THEN monto * tipo_cambio ELSE monto END, 2)) STORED,
  CONSTRAINT ck_gasto_tc CHECK (moneda = 'USD' OR tipo_cambio = 1)
);

ALTER TABLE movimiento_inventario ADD COLUMN compra_id bigint REFERENCES compra(id);
CREATE INDEX ix_mov_compra ON movimiento_inventario (compra_id) WHERE compra_id IS NOT NULL;

-- Una compra confirmada o cancelada ya no se toca; su detalle y gastos tampoco
CREATE OR REPLACE FUNCTION fn_proteger_compra() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las compras no se eliminan: una compra en borrador se cancela';
  END IF;
  IF OLD.estado <> 'BORRADOR' THEN
    RAISE EXCEPTION 'La compra % ya está % y no se puede modificar', OLD.id, lower(OLD.estado);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_compra_proteger BEFORE UPDATE OR DELETE ON compra
  FOR EACH ROW EXECUTE FUNCTION fn_proteger_compra();

CREATE OR REPLACE FUNCTION fn_proteger_hijos_compra() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_estado text;
BEGIN
  SELECT estado INTO v_estado FROM compra
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.compra_id ELSE NEW.compra_id END;
  -- Al confirmar, fn_confirmar_compra escribe los costos calculados: se permite con esta marca
  IF v_estado <> 'BORRADOR' AND coalesce(current_setting('app.confirmando_compra', true), '') <> 'si' THEN
    RAISE EXCEPTION 'La compra ya está % y no se puede modificar', lower(v_estado);
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER tg_compra_detalle_proteger BEFORE INSERT OR UPDATE OR DELETE ON compra_detalle
  FOR EACH ROW EXECUTE FUNCTION fn_proteger_hijos_compra();
CREATE TRIGGER tg_compra_gasto_proteger BEFORE INSERT OR UPDATE OR DELETE ON compra_gasto
  FOR EACH ROW EXECUTE FUNCTION fn_proteger_hijos_compra();

-- ---------------------------------------------------------------------
-- 4.2 Alertas para el administrador (margen bajo, diferencias, caja sin cerrar...)
-- ---------------------------------------------------------------------
CREATE TABLE alerta (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo          varchar(30)  NOT NULL CHECK (tipo ~ '^[A-Z_]+$'),   -- MARGEN_BAJO, ENVIO_DIFERENCIA, CAJA_DIFERENCIA...
  titulo        varchar(200) NOT NULL,
  detalle       jsonb        NOT NULL DEFAULT '{}'::jsonb,
  sucursal_id   integer      REFERENCES sucursal(id),
  creada_at     timestamptz  NOT NULL DEFAULT now(),
  atendida_por  bigint       REFERENCES usuario(id),
  atendida_at   timestamptz,
  CONSTRAINT ck_alerta_atendida CHECK ((atendida_por IS NULL) = (atendida_at IS NULL))
);
CREATE INDEX ix_alerta_pendiente ON alerta (creada_at DESC) WHERE atendida_at IS NULL;

-- ---------------------------------------------------------------------
-- 4.3 Envíos entre ubicaciones (dos pasos: enviar → recibir)
--   BORRADOR → EN_TRANSITO (sale del origen) → RECIBIDO / RECIBIDO_CON_DIFERENCIAS (entra al destino)
-- ---------------------------------------------------------------------
CREATE SEQUENCE seq_envio_numero;

CREATE TABLE envio (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  numero           varchar(20)  UNIQUE,                        -- ENV-000001, se asigna al enviar
  origen_id        integer      NOT NULL REFERENCES sucursal(id),
  destino_id       integer      NOT NULL REFERENCES sucursal(id),
  estado           varchar(24)  NOT NULL DEFAULT 'BORRADOR'
                     CHECK (estado IN ('BORRADOR','EN_TRANSITO','RECIBIDO','RECIBIDO_CON_DIFERENCIAS','CANCELADO')),
  notas            varchar(500),
  creado_por       bigint       NOT NULL REFERENCES usuario(id),
  created_at       timestamptz  NOT NULL DEFAULT now(),
  enviado_por      bigint       REFERENCES usuario(id),
  fecha_envio      timestamptz,
  recibido_por     bigint       REFERENCES usuario(id),
  fecha_recepcion  timestamptz,
  CONSTRAINT ck_envio_destino CHECK (origen_id <> destino_id),
  CONSTRAINT ck_envio_enviado CHECK ((estado IN ('BORRADOR','CANCELADO')) = (fecha_envio IS NULL)),
  CONSTRAINT ck_envio_recibido CHECK ((estado IN ('RECIBIDO','RECIBIDO_CON_DIFERENCIAS')) = (fecha_recepcion IS NOT NULL))
);
CREATE INDEX ix_envio_destino_estado ON envio (destino_id, estado);

CREATE TABLE envio_detalle (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  envio_id           bigint        NOT NULL REFERENCES envio(id) ON DELETE CASCADE,
  variante_id        bigint        NOT NULL REFERENCES variante(id),
  cantidad_enviada   integer       NOT NULL CHECK (cantidad_enviada > 0),
  cantidad_recibida  integer       CHECK (cantidad_recibida >= 0),
  costo_unitario     numeric(12,2),                            -- costo promedio al enviar
  CONSTRAINT ux_envio_variante UNIQUE (envio_id, variante_id),
  CONSTRAINT ck_envio_recibe_max CHECK (cantidad_recibida <= cantidad_enviada)
);

ALTER TABLE movimiento_inventario
  ADD CONSTRAINT fk_mov_envio FOREIGN KEY (envio_id) REFERENCES envio(id);
CREATE INDEX ix_mov_envio ON movimiento_inventario (envio_id) WHERE envio_id IS NOT NULL;

CREATE OR REPLACE FUNCTION fn_proteger_envio_detalle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_estado text;
BEGIN
  SELECT estado INTO v_estado FROM envio
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.envio_id ELSE NEW.envio_id END;
  IF v_estado <> 'BORRADOR' AND coalesce(current_setting('app.procesando_envio', true), '') <> 'si' THEN
    RAISE EXCEPTION 'El envío ya está % y su detalle no se puede modificar', CASE v_estado WHEN 'EN_TRANSITO' THEN 'en tránsito' WHEN 'RECIBIDO_CON_DIFERENCIAS' THEN 'recibido' ELSE lower(v_estado) END;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER tg_envio_detalle_proteger BEFORE INSERT OR UPDATE OR DELETE ON envio_detalle
  FOR EACH ROW EXECUTE FUNCTION fn_proteger_envio_detalle();

CREATE OR REPLACE FUNCTION fn_proteger_envio() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Los envíos no se eliminan: un borrador se cancela'; END IF;
  IF OLD.estado IN ('RECIBIDO','RECIBIDO_CON_DIFERENCIAS','CANCELADO') THEN
    RAISE EXCEPTION 'El envío % ya está cerrado', coalesce(OLD.numero, OLD.id::text);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_envio_proteger BEFORE UPDATE OR DELETE ON envio
  FOR EACH ROW EXECUTE FUNCTION fn_proteger_envio();

-- ---------------------------------------------------------------------
-- 4.4 Mermas (la sucursal reporta, el admin aprueba) y conteos físicos
-- ---------------------------------------------------------------------
CREATE TABLE merma (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sucursal_id         integer      NOT NULL REFERENCES sucursal(id),
  variante_id         bigint       NOT NULL REFERENCES variante(id),
  cantidad            integer      NOT NULL CHECK (cantidad > 0),
  motivo              varchar(200) NOT NULL CHECK (length(trim(motivo)) >= 5),
  foto_url            varchar(300),
  estado              varchar(10)  NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','APROBADA','RECHAZADA')),
  reportada_por       bigint       NOT NULL REFERENCES usuario(id),
  reportada_at        timestamptz  NOT NULL DEFAULT now(),
  resuelta_por        bigint       REFERENCES usuario(id),
  resuelta_at         timestamptz,
  comentario          varchar(200),
  movimiento_id       bigint       REFERENCES movimiento_inventario(id),
  CONSTRAINT ck_merma_resuelta CHECK ((estado = 'PENDIENTE') = (resuelta_at IS NULL)),
  CONSTRAINT ck_merma_movimiento CHECK ((estado = 'APROBADA') = (movimiento_id IS NOT NULL))
);
CREATE INDEX ix_merma_pendiente ON merma (sucursal_id) WHERE estado = 'PENDIENTE';

-- Conteo físico: ABIERTO (se escanea) → ENVIADO (foto del stock del sistema) → APLICADO (ajustes) / CANCELADO
CREATE TABLE conteo (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sucursal_id   integer      NOT NULL REFERENCES sucursal(id),
  categoria_id  integer      REFERENCES categoria(id),         -- NULL = conteo total de la ubicación
  estado        varchar(10)  NOT NULL DEFAULT 'ABIERTO' CHECK (estado IN ('ABIERTO','ENVIADO','APLICADO','CANCELADO')),
  iniciado_por  bigint       NOT NULL REFERENCES usuario(id),
  iniciado_at   timestamptz  NOT NULL DEFAULT now(),
  enviado_por   bigint       REFERENCES usuario(id),
  enviado_at    timestamptz,
  aplicado_por  bigint       REFERENCES usuario(id),
  aplicado_at   timestamptz,
  notas         varchar(500)
);
-- Un solo conteo en curso por ubicación
CREATE UNIQUE INDEX ux_conteo_en_curso ON conteo (sucursal_id) WHERE estado IN ('ABIERTO','ENVIADO');

CREATE TABLE conteo_detalle (
  conteo_id        bigint  NOT NULL REFERENCES conteo(id) ON DELETE CASCADE,
  variante_id      bigint  NOT NULL REFERENCES variante(id),
  cantidad_contada integer NOT NULL DEFAULT 0 CHECK (cantidad_contada >= 0),
  stock_sistema    integer,                                    -- foto al enviar el conteo
  PRIMARY KEY (conteo_id, variante_id)
);

-- =====================================================================
-- 5. CAJA: métodos de pago, tipo de cambio, turnos, movimientos de efectivo
-- =====================================================================
CREATE TABLE metodo_pago (
  id                   smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo               varchar(20) NOT NULL UNIQUE CHECK (codigo ~ '^[A-Z_]+$'),
  nombre               varchar(40) NOT NULL,
  es_efectivo          boolean     NOT NULL DEFAULT false,   -- permite vuelto y cuadra con monto inicial
  requiere_referencia  boolean     NOT NULL DEFAULT false,   -- nº de voucher / transferencia
  activo               boolean     NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX ux_metodo_pago_un_efectivo ON metodo_pago (es_efectivo) WHERE es_efectivo;

-- Parámetros generales editables por el administrador
CREATE TABLE parametro (
  clave        varchar(40)  PRIMARY KEY CHECK (clave ~ '^[A-Z0-9_]+$'),
  valor        varchar(200),                 -- NULL / vacío = sin valor
  tipo_valor   varchar(10)  NOT NULL DEFAULT 'TEXTO' CHECK (tipo_valor IN ('NUMERO','HORA','OPCION','TEXTO')),
  opciones     text[],                       -- valores válidos cuando tipo_valor = 'OPCION'
  permite_vacio boolean     NOT NULL DEFAULT false,
  minimo       numeric,                      -- valor mínimo cuando tipo_valor = 'NUMERO' (NULL = de 0 en adelante)
  descripcion  varchar(300) NOT NULL,
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT ck_parametro_opciones CHECK ((tipo_valor = 'OPCION') = (opciones IS NOT NULL)),
  CONSTRAINT ck_parametro_minimo CHECK (minimo IS NULL OR tipo_valor = 'NUMERO')
);

-- El panel no puede guardar un valor con formato inválido
CREATE OR REPLACE FUNCTION fn_validar_parametro() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v text := NULLIF(trim(NEW.valor), '');
BEGIN
  IF v IS NULL THEN
    IF NOT NEW.permite_vacio THEN
      RAISE EXCEPTION 'El parámetro % no puede quedar vacío', NEW.clave;
    END IF;
    RETURN NEW;
  END IF;
  CASE NEW.tipo_valor
    WHEN 'NUMERO' THEN
      IF v !~ '^[0-9]+(\.[0-9]+)?$' THEN
        RAISE EXCEPTION 'El parámetro % debe ser un número positivo (recibido: %)', NEW.clave, v;
      END IF;
      IF NEW.minimo IS NOT NULL AND v::numeric < NEW.minimo THEN
        RAISE EXCEPTION 'El parámetro % no puede ser menor que % (recibido: %)', NEW.clave, NEW.minimo, v;
      END IF;
    WHEN 'HORA' THEN
      IF v !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
        RAISE EXCEPTION 'El parámetro % debe ser una hora HH:MM (recibido: %)', NEW.clave, v;
      END IF;
    WHEN 'OPCION' THEN
      IF NOT (v = ANY (NEW.opciones)) THEN
        RAISE EXCEPTION 'Valor inválido para %: %. Opciones: %', NEW.clave, v, array_to_string(NEW.opciones, ', ');
      END IF;
    ELSE NULL;
  END CASE;
  NEW.valor := v;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_parametro_validar BEFORE INSERT OR UPDATE ON parametro
  FOR EACH ROW EXECUTE FUNCTION fn_validar_parametro();

CREATE OR REPLACE FUNCTION fn_parametro_num(p_clave text) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(trim(valor), '')::numeric FROM parametro WHERE clave = p_clave
$$;

CREATE OR REPLACE FUNCTION fn_parametro_txt(p_clave text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(trim(valor), '') FROM parametro WHERE clave = p_clave
$$;

CREATE TABLE tipo_cambio (
  fecha       date          PRIMARY KEY,
  usd_a_nio   numeric(10,4) NOT NULL CHECK (usd_a_nio > 0),
  usuario_id  bigint REFERENCES usuario(id),
  created_at  timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE turno_caja (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  caja_id                integer       NOT NULL REFERENCES caja(id),
  usuario_apertura_id    bigint        NOT NULL REFERENCES usuario(id),
  fecha_apertura         timestamptz   NOT NULL DEFAULT now(),
  monto_inicial_nio      numeric(12,2) NOT NULL DEFAULT 0 CHECK (monto_inicial_nio >= 0),
  monto_inicial_usd      numeric(12,2) NOT NULL DEFAULT 0 CHECK (monto_inicial_usd >= 0),
  -- Fondo que debía haber según el cierre anterior (NULL = primer turno de la caja)
  fondo_esperado_nio     numeric(12,2),
  fondo_esperado_usd     numeric(12,2),
  diferencia_apertura_nio numeric(12,2) GENERATED ALWAYS AS (monto_inicial_nio - fondo_esperado_nio) STORED,
  diferencia_apertura_usd numeric(12,2) GENERATED ALWAYS AS (monto_inicial_usd - fondo_esperado_usd) STORED,
  estado                 varchar(10)   NOT NULL DEFAULT 'ABIERTO' CHECK (estado IN ('ABIERTO','CERRADO')),
  usuario_cierre_id      bigint        REFERENCES usuario(id),
  fecha_cierre           timestamptz,
  -- Al cerrar: efectivo que se retira y lo que queda como fondo del día siguiente
  retiro_nio             numeric(12,2) CHECK (retiro_nio >= 0),
  retiro_usd             numeric(12,2) CHECK (retiro_usd >= 0),
  fondo_siguiente_nio    numeric(12,2) CHECK (fondo_siguiente_nio >= 0),
  fondo_siguiente_usd    numeric(12,2) CHECK (fondo_siguiente_usd >= 0),
  justificacion_diferencia varchar(500),
  cierre_forzado         boolean       NOT NULL DEFAULT false,
  observaciones          varchar(500),
  -- Conteos de cierre que no cuadraron y no se cerraron (arqueo ciego: solo se permite un reconteo)
  intentos_cierre        smallint      NOT NULL DEFAULT 0 CHECK (intentos_cierre >= 0),
  CONSTRAINT ck_turno_cierre CHECK (
    (estado = 'ABIERTO' AND fecha_cierre IS NULL AND usuario_cierre_id IS NULL AND fondo_siguiente_nio IS NULL) OR
    (estado = 'CERRADO' AND fecha_cierre IS NOT NULL AND usuario_cierre_id IS NOT NULL
                        AND fondo_siguiente_nio IS NOT NULL AND fondo_siguiente_usd IS NOT NULL))
);
-- Solo un turno abierto por caja
CREATE UNIQUE INDEX ux_turno_abierto_por_caja ON turno_caja (caja_id) WHERE estado = 'ABIERTO';

-- Billetes y monedas válidos (para el conteo por denominación)
CREATE TABLE denominacion (
  moneda  char(3)       NOT NULL CHECK (moneda IN ('NIO','USD')),
  valor   numeric(10,2) NOT NULL CHECK (valor > 0),
  tipo    varchar(7)    NOT NULL CHECK (tipo IN ('BILLETE','MONEDA')),
  activa  boolean       NOT NULL DEFAULT true,
  PRIMARY KEY (moneda, valor, tipo)
);

-- Conteo del efectivo al cierre, billete por billete
CREATE TABLE cierre_denominacion (
  turno_id  bigint        NOT NULL REFERENCES turno_caja(id),
  moneda    char(3)       NOT NULL,
  valor     numeric(10,2) NOT NULL,
  cantidad  integer       NOT NULL CHECK (cantidad >= 0),
  PRIMARY KEY (turno_id, moneda, valor)
);

-- Retiros / ingresos de efectivo durante el turno (pago a proveedor, cambio de billetes…)
CREATE TABLE caja_movimiento (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  turno_id    bigint        NOT NULL REFERENCES turno_caja(id),
  tipo        varchar(7)    NOT NULL CHECK (tipo IN ('INGRESO','EGRESO')),
  moneda      char(3)       NOT NULL CHECK (moneda IN ('NIO','USD')),
  monto       numeric(12,2) NOT NULL CHECK (monto > 0),
  motivo      varchar(200)  NOT NULL CHECK (length(trim(motivo)) >= 5),
  usuario_id  bigint        NOT NULL REFERENCES usuario(id),
  fecha       timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX ix_caja_mov_turno ON caja_movimiento (turno_id);

-- =====================================================================
-- 6. VENTAS
-- =====================================================================
-- Promociones: la única forma de cobrar menos. Las crea y activa el admin; el vendedor elige una al cobrar.
-- Se aplican a toda la venta, una por venta.
CREATE TABLE promocion (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre         varchar(80)   NOT NULL UNIQUE,
  descripcion    varchar(300),
  tipo           varchar(10)   NOT NULL CHECK (tipo IN ('PORCENTAJE','MONTO')),
  valor          numeric(12,2) NOT NULL CHECK (valor > 0),          -- % o córdobas
  compra_minima  numeric(12,2) NOT NULL DEFAULT 0 CHECK (compra_minima >= 0),
  vigente_desde  date,                                             -- NULL = sin límite
  vigente_hasta  date,
  activa         boolean       NOT NULL DEFAULT false,
  created_by     bigint        REFERENCES usuario(id),
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT ck_promo_pct CHECK (tipo <> 'PORCENTAJE' OR valor <= 100),
  CONSTRAINT ck_promo_fechas CHECK (vigente_desde IS NULL OR vigente_hasta IS NULL OR vigente_desde <= vigente_hasta)
);

CREATE TABLE venta (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  numero            varchar(20)   NOT NULL UNIQUE,              -- LAM-00000001
  sucursal_id       integer       NOT NULL REFERENCES sucursal(id),
  turno_id          bigint        NOT NULL REFERENCES turno_caja(id),
  vendedor_id       bigint        NOT NULL REFERENCES usuario(id),
  cliente_nombre    varchar(120),
  cliente_telefono  varchar(20),
  fecha             timestamptz   NOT NULL DEFAULT now(),
  subtotal          numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  descuento         numeric(12,2) NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  total             numeric(12,2) NOT NULL,
  tipo_cambio       numeric(10,4) NOT NULL CHECK (tipo_cambio > 0),   -- snapshot del día
  estado            varchar(10)   NOT NULL DEFAULT 'COMPLETADA' CHECK (estado IN ('COMPLETADA','ANULADA')),
  anulada_por       bigint        REFERENCES usuario(id),
  fecha_anulacion   timestamptz,
  motivo_anulacion  varchar(200),
  notas             varchar(500),
  promocion_id      integer       REFERENCES promocion(id),
  clave_idempotencia uuid         UNIQUE,                         -- la envía el POS: evita ventas duplicadas
  CONSTRAINT ck_venta_total CHECK (descuento <= subtotal AND total = subtotal - descuento),
  CONSTRAINT ck_venta_descuento_promo CHECK (descuento = 0 OR promocion_id IS NOT NULL),
  CONSTRAINT ck_venta_anulacion CHECK (
    (estado = 'COMPLETADA' AND anulada_por IS NULL AND fecha_anulacion IS NULL AND motivo_anulacion IS NULL) OR
    (estado = 'ANULADA' AND anulada_por IS NOT NULL AND fecha_anulacion IS NOT NULL AND length(trim(motivo_anulacion)) >= 5))
);
CREATE INDEX ix_venta_sucursal_fecha ON venta (sucursal_id, fecha DESC);
CREATE INDEX ix_venta_turno ON venta (turno_id);
CREATE INDEX ix_venta_vendedor_fecha ON venta (vendedor_id, fecha DESC);

ALTER TABLE movimiento_inventario
  ADD CONSTRAINT fk_mov_venta FOREIGN KEY (venta_id) REFERENCES venta(id);

CREATE TABLE venta_detalle (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  venta_id         bigint        NOT NULL REFERENCES venta(id),
  variante_id      bigint        NOT NULL REFERENCES variante(id),
  cantidad         integer       NOT NULL CHECK (cantidad > 0),
  precio_lista     numeric(12,2) NOT NULL CHECK (precio_lista >= 0),      -- precio establecido (snapshot)
  precio_unitario  numeric(12,2) NOT NULL,                                -- precio cobrado (≥ lista)
  costo_unitario   numeric(12,2) NOT NULL CHECK (costo_unitario >= 0),    -- snapshot (paquete: servicio + piezas)
  subtotal         numeric(12,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED,
  CONSTRAINT ck_detalle_precio_no_menor CHECK (precio_unitario >= precio_lista)
);

-- Piezas que salieron del inventario en cada línea de paquete
CREATE TABLE venta_detalle_pieza (
  venta_detalle_id  bigint        NOT NULL REFERENCES venta_detalle(id),
  variante_id       bigint        NOT NULL REFERENCES variante(id),
  cantidad          integer       NOT NULL CHECK (cantidad > 0),
  costo_unitario    numeric(12,2) NOT NULL,
  PRIMARY KEY (venta_detalle_id, variante_id)
);
CREATE INDEX ix_venta_detalle_venta ON venta_detalle (venta_id);
CREATE INDEX ix_venta_detalle_variante ON venta_detalle (variante_id);

-- Pagos: una venta puede tener varios (mixto). El vuelto se guarda como
-- pago negativo en efectivo NIO, así el cierre de caja cuadra exacto.
CREATE TABLE venta_pago (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  venta_id        bigint        NOT NULL REFERENCES venta(id),
  metodo_pago_id  smallint      NOT NULL REFERENCES metodo_pago(id),
  moneda          char(3)       NOT NULL CHECK (moneda IN ('NIO','USD')),
  monto           numeric(12,2) NOT NULL CHECK (monto <> 0),
  tipo_cambio     numeric(10,4) NOT NULL CHECK (tipo_cambio > 0),
  monto_nio       numeric(12,2) GENERATED ALWAYS AS
                    (round(CASE WHEN moneda = 'USD' THEN monto * tipo_cambio ELSE monto END, 2)) STORED,
  referencia      varchar(60),
  es_vuelto       boolean       NOT NULL DEFAULT false,
  CONSTRAINT ck_pago_vuelto CHECK (es_vuelto = (monto < 0)),
  CONSTRAINT ck_pago_tc_nio CHECK (moneda = 'USD' OR tipo_cambio = 1)
);
CREATE INDEX ix_venta_pago_venta ON venta_pago (venta_id);

CREATE TABLE cierre_caja_detalle (
  turno_id        bigint        NOT NULL REFERENCES turno_caja(id),
  metodo_pago_id  smallint      NOT NULL REFERENCES metodo_pago(id),
  moneda          char(3)       NOT NULL CHECK (moneda IN ('NIO','USD')),
  monto_esperado  numeric(12,2) NOT NULL,
  monto_contado   numeric(12,2) NOT NULL,
  diferencia      numeric(12,2) GENERATED ALWAYS AS (monto_contado - monto_esperado) STORED,
  PRIMARY KEY (turno_id, metodo_pago_id, moneda)
);

-- ---------------------------------------------------------------------
-- 6.1 Reglas de integridad de ventas (defensa aunque el backend use el ORM)
-- ---------------------------------------------------------------------
-- a) Solo se vende en un turno ABIERTO de una caja de la misma sucursal
CREATE OR REPLACE FUNCTION fn_validar_turno_venta() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_estado text; v_sucursal integer;
BEGIN
  SELECT t.estado, c.sucursal_id INTO v_estado, v_sucursal
    FROM turno_caja t JOIN caja c ON c.id = t.caja_id
   WHERE t.id = NEW.turno_id;
  IF v_estado IS DISTINCT FROM 'ABIERTO' THEN
    RAISE EXCEPTION 'El turno % no está abierto', NEW.turno_id;
  END IF;
  IF v_sucursal <> NEW.sucursal_id THEN
    RAISE EXCEPTION 'El turno % pertenece a otra sucursal', NEW.turno_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_venta_turno BEFORE INSERT ON venta
  FOR EACH ROW EXECUTE FUNCTION fn_validar_turno_venta();

CREATE OR REPLACE FUNCTION fn_validar_turno_caja_mov() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT estado FROM turno_caja WHERE id = NEW.turno_id) <> 'ABIERTO' THEN
    RAISE EXCEPTION 'El turno % no está abierto', NEW.turno_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_caja_mov_turno BEFORE INSERT ON caja_movimiento
  FOR EACH ROW EXECUTE FUNCTION fn_validar_turno_caja_mov();

-- b) Una venta solo puede pasar de COMPLETADA a ANULADA; nada más cambia
CREATE OR REPLACE FUNCTION fn_proteger_venta() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las ventas no se eliminan: se anulan';
  END IF;
  IF OLD.estado = 'ANULADA' THEN
    RAISE EXCEPTION 'La venta % ya está anulada', OLD.numero;
  END IF;
  IF (NEW.numero, NEW.sucursal_id, NEW.turno_id, NEW.vendedor_id, NEW.fecha,
      NEW.subtotal, NEW.descuento, NEW.total, NEW.tipo_cambio)
     IS DISTINCT FROM
     (OLD.numero, OLD.sucursal_id, OLD.turno_id, OLD.vendedor_id, OLD.fecha,
      OLD.subtotal, OLD.descuento, OLD.total, OLD.tipo_cambio) THEN
    RAISE EXCEPTION 'Los datos de una venta registrada no se modifican (venta %)', OLD.numero;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_venta_proteger BEFORE UPDATE OR DELETE ON venta
  FOR EACH ROW EXECUTE FUNCTION fn_proteger_venta();
CREATE TRIGGER tg_detalle_inmutable BEFORE UPDATE OR DELETE ON venta_detalle
  FOR EACH ROW EXECUTE FUNCTION fn_bloquear_modificacion();
CREATE TRIGGER tg_detalle_pieza_inmutable BEFORE UPDATE OR DELETE ON venta_detalle_pieza
  FOR EACH ROW EXECUTE FUNCTION fn_bloquear_modificacion();
CREATE TRIGGER tg_pago_inmutable BEFORE UPDATE OR DELETE ON venta_pago
  FOR EACH ROW EXECUTE FUNCTION fn_bloquear_modificacion();
CREATE TRIGGER tg_cierre_denominacion_inmutable BEFORE UPDATE OR DELETE ON cierre_denominacion
  FOR EACH ROW EXECUTE FUNCTION fn_bloquear_modificacion();
CREATE TRIGGER tg_cierre_inmutable BEFORE UPDATE OR DELETE ON cierre_caja_detalle
  FOR EACH ROW EXECUTE FUNCTION fn_bloquear_modificacion();

-- c) Al hacer COMMIT: detalle cuadra con subtotal y pagos cuadran con total
CREATE OR REPLACE FUNCTION fn_validar_cuadre_venta() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_detalle numeric; v_pagos numeric; v_lineas int;
BEGIN
  SELECT count(*), coalesce(sum(subtotal),0) INTO v_lineas, v_detalle
    FROM venta_detalle WHERE venta_id = NEW.id;
  SELECT coalesce(sum(monto_nio),0) INTO v_pagos
    FROM venta_pago WHERE venta_id = NEW.id;
  IF v_lineas = 0 THEN
    RAISE EXCEPTION 'La venta % no tiene productos', NEW.numero;
  END IF;
  IF v_detalle <> NEW.subtotal THEN
    RAISE EXCEPTION 'Venta %: el detalle (%) no cuadra con el subtotal (%)', NEW.numero, v_detalle, NEW.subtotal;
  END IF;
  IF v_pagos <> NEW.total THEN
    RAISE EXCEPTION 'Venta %: los pagos (%) no cuadran con el total (%)', NEW.numero, v_pagos, NEW.total;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER tg_venta_cuadre AFTER INSERT ON venta
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_validar_cuadre_venta();

-- =====================================================================
-- 7. AUDITORÍA Y REGLAS DE USUARIOS
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_auditar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_antes   jsonb;
  v_despues jsonb;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN v_antes   := to_jsonb(OLD) - 'password_hash' - 'token_hash' - 'updated_at'; END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN v_despues := to_jsonb(NEW) - 'password_hash' - 'token_hash' - 'updated_at'; END IF;

  IF TG_OP = 'UPDATE' THEN
    IF to_jsonb(OLD)->>'password_hash' IS DISTINCT FROM to_jsonb(NEW)->>'password_hash' THEN
      v_despues := v_despues || '{"password":"(cambiada)"}'::jsonb;
    ELSIF v_antes = v_despues THEN
      RETURN NULL;                       -- nada relevante cambió
    END IF;
  END IF;

  INSERT INTO auditoria (tabla, registro_id, accion, antes, despues, usuario_id)
  VALUES (TG_TABLE_NAME,
          coalesce(v_despues->>'id', v_antes->>'id', v_despues->>'clave', v_antes->>'clave'),
          TG_OP, v_antes, v_despues, fn_usuario_actual());
  RETURN NULL;
END $$;

-- updated_at + auditoría en tablas maestras
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sucursal','usuario','producto','variante','parametro','promocion'] LOOP
    EXECUTE format('CREATE TRIGGER tg_%1$s_updated BEFORE UPDATE ON %1$I
                    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['sucursal','caja','rol','rol_permiso','usuario','usuario_sucursal',
                           'categoria','producto','variante','metodo_pago','tipo_cambio','parametro','dispositivo','promocion'] LOOP
    EXECUTE format('CREATE TRIGGER tg_%1$s_auditoria AFTER INSERT OR UPDATE OR DELETE ON %1$I
                    FOR EACH ROW EXECUTE FUNCTION fn_auditar()', t);
  END LOOP;
END $$;

-- Historial de precios/costos
CREATE OR REPLACE FUNCTION fn_historial_precio() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.precio_venta, NEW.costo) IS DISTINCT FROM (OLD.precio_venta, OLD.costo) THEN
    INSERT INTO historial_precio (variante_id, precio_anterior, precio_nuevo, costo_anterior, costo_nuevo, usuario_id)
    VALUES (NEW.id, OLD.precio_venta, NEW.precio_venta, OLD.costo, NEW.costo, fn_usuario_actual());
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER tg_variante_historial AFTER UPDATE ON variante
  FOR EACH ROW EXECUTE FUNCTION fn_historial_precio();

-- Los usuarios no se eliminan (tienen ventas asociadas): se desactivan
CREATE OR REPLACE FUNCTION fn_no_eliminar_usuario() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Los usuarios no se eliminan: desactívelos (activo = false)';
END $$;
CREATE TRIGGER tg_usuario_no_delete BEFORE DELETE ON usuario
  FOR EACH ROW EXECUTE FUNCTION fn_no_eliminar_usuario();

-- Siempre debe existir al menos un ADMIN activo
CREATE OR REPLACE FUNCTION fn_validar_ultimo_admin() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuario u JOIN rol r ON r.id = u.rol_id
                  WHERE r.codigo = 'ADMIN' AND u.activo) THEN
    RAISE EXCEPTION 'Operación rechazada: debe quedar al menos un administrador activo';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER tg_usuario_ultimo_admin AFTER UPDATE OF activo, rol_id ON usuario
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION fn_validar_ultimo_admin();

-- Al desactivar, cambiar contraseña o cambiar rol → se revocan sus sesiones
CREATE OR REPLACE FUNCTION fn_revocar_sesiones_usuario() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.activo AND NOT NEW.activo)
     OR NEW.password_hash IS DISTINCT FROM OLD.password_hash
     OR NEW.rol_id <> OLD.rol_id THEN
    UPDATE sesion SET revocada_at = now()
     WHERE usuario_id = NEW.id AND revocada_at IS NULL;
  END IF;
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
    NEW.password_actualizado_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_usuario_revocar BEFORE UPDATE ON usuario
  FOR EACH ROW EXECUTE FUNCTION fn_revocar_sesiones_usuario();

-- Al desactivar un equipo → se cierran las sesiones abiertas desde él
CREATE OR REPLACE FUNCTION fn_revocar_sesiones_dispositivo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.activo AND NOT NEW.activo THEN
    UPDATE sesion SET revocada_at = now()
     WHERE dispositivo_id = NEW.id AND revocada_at IS NULL;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER tg_dispositivo_revocar AFTER UPDATE OF activo ON dispositivo
  FOR EACH ROW EXECUTE FUNCTION fn_revocar_sesiones_dispositivo();

-- Los roles de sistema no se eliminan
CREATE OR REPLACE FUNCTION fn_proteger_rol() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.es_sistema THEN
    RAISE EXCEPTION 'El rol % es de sistema y no se puede eliminar', OLD.codigo;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER tg_rol_proteger BEFORE DELETE ON rol
  FOR EACH ROW EXECUTE FUNCTION fn_proteger_rol();

-- =====================================================================
-- 8. FUNCIONES DE SEGURIDAD
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_tiene_permiso(p_usuario bigint, p_permiso text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
      FROM usuario u
      JOIN rol r ON r.id = u.rol_id
     WHERE u.id = p_usuario
       AND u.activo
       AND ( r.codigo = 'ADMIN'                           -- el admin tiene todo
             OR EXISTS (SELECT 1 FROM rol_permiso rp JOIN permiso p ON p.id = rp.permiso_id
                         WHERE rp.rol_id = r.id AND p.codigo = p_permiso)))
$$;

CREATE OR REPLACE FUNCTION fn_exigir_permiso(p_usuario bigint, p_permiso text) RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF NOT fn_tiene_permiso(p_usuario, p_permiso) THEN
    RAISE EXCEPTION 'Permiso denegado: se requiere %', p_permiso
          USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_puede_operar_sucursal(p_usuario bigint, p_sucursal integer) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT fn_tiene_permiso(p_usuario, 'SUCURSALES_TODAS')
      OR EXISTS (SELECT 1 FROM usuario_sucursal us JOIN usuario u ON u.id = us.usuario_id
                  WHERE us.usuario_id = p_usuario AND us.sucursal_id = p_sucursal AND u.activo)
$$;

CREATE OR REPLACE FUNCTION fn_exigir_sucursal(p_usuario bigint, p_sucursal integer) RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF NOT fn_puede_operar_sucursal(p_usuario, p_sucursal) THEN
    RAISE EXCEPTION 'El usuario % no está asignado a la sucursal %', p_usuario, p_sucursal
          USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;

-- ¿Puede el usuario trabajar desde este equipo? El admin, desde cualquiera (o sin equipo
-- registrado); los demás roles solo desde un equipo registrado y activo de una de sus sucursales.
CREATE OR REPLACE FUNCTION fn_equipo_autorizado(p_usuario bigint, p_dispositivo uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_dispositivo IS NULL THEN
      EXISTS (SELECT 1 FROM usuario u JOIN rol r ON r.id = u.rol_id
               WHERE u.id = p_usuario AND u.activo AND r.codigo = 'ADMIN')
    ELSE
      EXISTS (SELECT 1 FROM dispositivo d
               WHERE d.id = p_dispositivo AND d.activo AND fn_puede_operar_sucursal(p_usuario, d.sucursal_id))
  END
$$;

-- Intento de inicio de sesión. El backend verifica el hash de la contraseña (argon2id; bcrypt en
-- los usuarios del seed) y llama a esta función con el resultado; aquí se decide si el ingreso procede:
--   OK                      contraseña correcta, usuario activo y equipo autorizado (reinicia el contador)
--   CREDENCIALES_INVALIDAS  usuario inexistente o contraseña incorrecta
--   BLOQUEADO               5 fallos seguidos bloquean 15 minutos; mientras dura, ni la contraseña
--                           correcta entra ni se cuentan más fallos. Cumplido, el contador vuelve a empezar.
--   INACTIVO                usuario desactivado (solo se informa si la contraseña es correcta)
--   EQUIPO_NO_AUTORIZADO    encargados y vendedores solo entran desde un equipo registrado de sus sucursales
CREATE OR REPLACE FUNCTION fn_registrar_login(
  p_username text, p_exito boolean, p_ip inet DEFAULT NULL, p_user_agent text DEFAULT NULL,
  p_dispositivo uuid DEFAULT NULL
) RETURNS TABLE (resultado text, id_usuario bigint, minutos_bloqueo integer)
LANGUAGE plpgsql AS $$
DECLARE
  u          usuario%ROWTYPE;
  v_motivo   text;
  v_intentos integer;
BEGIN
  SELECT * INTO u FROM usuario WHERE username = lower(trim(p_username)) FOR UPDATE;

  IF u.id IS NULL THEN
    resultado := 'CREDENCIALES_INVALIDAS'; v_motivo := 'usuario inexistente';
  ELSIF u.bloqueado_hasta > now() THEN
    resultado := 'BLOQUEADO'; v_motivo := 'cuenta bloqueada';
  ELSIF NOT p_exito THEN
    resultado := 'CREDENCIALES_INVALIDAS'; v_motivo := 'contraseña incorrecta';
    IF u.activo THEN
      v_intentos := CASE WHEN u.bloqueado_hasta <= now() THEN 1 ELSE u.intentos_fallidos + 1 END;
      UPDATE usuario
         SET intentos_fallidos = v_intentos,
             bloqueado_hasta = CASE WHEN v_intentos >= 5 THEN now() + interval '15 minutes' END
       WHERE id = u.id
      RETURNING bloqueado_hasta INTO u.bloqueado_hasta;
      IF v_intentos >= 5 THEN resultado := 'BLOQUEADO'; END IF;
    END IF;
  ELSIF NOT u.activo THEN
    resultado := 'INACTIVO'; v_motivo := 'usuario inactivo';
  ELSIF NOT fn_equipo_autorizado(u.id, p_dispositivo) THEN
    resultado := 'EQUIPO_NO_AUTORIZADO'; v_motivo := 'equipo no autorizado';
  ELSE
    resultado := 'OK';
    UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = now()
     WHERE id = u.id;
  END IF;

  INSERT INTO acceso_log (usuario_id, username_intentado, exito, motivo, ip, user_agent, dispositivo_id)
  VALUES (u.id, left(lower(trim(p_username)), 40), resultado = 'OK', v_motivo, p_ip,
          left(p_user_agent, 300), p_dispositivo);

  id_usuario := u.id;
  minutos_bloqueo := CASE WHEN resultado = 'BLOQUEADO'
                          THEN ceil(extract(epoch FROM u.bloqueado_hasta - now()) / 60)::integer END;
  RETURN NEXT;
END $$;

-- Sesiones. El backend genera el token de renovación, lo entrega al navegador en una cookie
-- httpOnly y aquí solo se guarda su SHA-256. Duración según parámetros: SESION_HORAS_EQUIPO si se
-- inicia en un equipo registrado, SESION_DIAS_SIN_EQUIPO si no (solo el admin entra sin equipo).
CREATE OR REPLACE FUNCTION fn_crear_sesion(
  p_usuario bigint, p_token_hash text, p_dispositivo uuid DEFAULT NULL,
  p_ip inet DEFAULT NULL, p_user_agent text DEFAULT NULL
) RETURNS TABLE (sesion_id uuid, expira_at timestamptz)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
BEGIN
  IF NOT fn_equipo_autorizado(p_usuario, p_dispositivo) THEN
    RAISE EXCEPTION 'El usuario % no puede iniciar sesión desde este equipo', p_usuario
          USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    INSERT INTO sesion (usuario_id, dispositivo_id, refresh_token_hash, ip, user_agent, expira_at)
    VALUES (p_usuario, p_dispositivo, p_token_hash, p_ip, left(p_user_agent, 300),
            now() + CASE WHEN p_dispositivo IS NULL
                         THEN coalesce(fn_parametro_num('SESION_DIAS_SIN_EQUIPO'), 7)::float8 * interval '1 day'
                         ELSE coalesce(fn_parametro_num('SESION_HORAS_EQUIPO'), 12)::float8 * interval '1 hour' END)
    RETURNING id, expira_at;
END $$;

-- Renovación con rotación: cada token de renovación sirve una sola vez. La sesión vieja queda
-- revocada y apunta a la nueva, que conserva el mismo vencimiento (renovar no alarga la sesión).
-- Si un token ya rotado vuelve a presentarse pasados 30 segundos (no es una carrera entre dos
-- pestañas), alguien pudo haberlo copiado: se cierran todas las sesiones del usuario y se alerta.
-- Devuelve vacío si el token no sirve: inexistente, vencido, revocado, o usuario/equipo ya no autorizados.
CREATE OR REPLACE FUNCTION fn_renovar_sesion(
  p_token_hash text, p_token_hash_nuevo text, p_ip inet DEFAULT NULL, p_user_agent text DEFAULT NULL
) RETURNS TABLE (sesion_id uuid, usuario_id bigint, dispositivo_id uuid, expira_at timestamptz)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  s       sesion%ROWTYPE;
  v_nueva uuid;
BEGIN
  SELECT * INTO s FROM sesion WHERE refresh_token_hash = p_token_hash FOR UPDATE;
  IF s.id IS NULL OR s.expira_at <= now() THEN RETURN; END IF;

  IF s.revocada_at IS NOT NULL THEN
    IF s.reemplazada_por IS NOT NULL AND s.revocada_at < now() - interval '30 seconds' THEN
      UPDATE sesion SET revocada_at = now() WHERE usuario_id = s.usuario_id AND revocada_at IS NULL;
      INSERT INTO alerta (tipo, titulo, detalle)
      SELECT 'SESION_REUTILIZADA',
             'Posible robo de sesión de ' || u.username || ': se cerraron todas sus sesiones',
             jsonb_build_object('usuario_id', u.id, 'ip', host(p_ip), 'user_agent', left(p_user_agent, 300))
        FROM usuario u WHERE u.id = s.usuario_id;
    END IF;
    RETURN;
  END IF;

  IF NOT fn_equipo_autorizado(s.usuario_id, s.dispositivo_id) THEN
    UPDATE sesion SET revocada_at = now() WHERE id = s.id;
    RETURN;
  END IF;

  INSERT INTO sesion (usuario_id, dispositivo_id, refresh_token_hash, ip, user_agent, expira_at)
  VALUES (s.usuario_id, s.dispositivo_id, p_token_hash_nuevo, p_ip, left(p_user_agent, 300), s.expira_at)
  RETURNING id INTO v_nueva;
  UPDATE sesion SET revocada_at = now(), reemplazada_por = v_nueva WHERE id = s.id;

  RETURN QUERY SELECT v_nueva, s.usuario_id, s.dispositivo_id, s.expira_at;
END $$;

-- Cierre de sesión (logout). true si había una sesión abierta con ese token.
CREATE OR REPLACE FUNCTION fn_cerrar_sesion(p_token_hash text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE sesion SET revocada_at = now() WHERE refresh_token_hash = p_token_hash AND revocada_at IS NULL;
  RETURN FOUND;
END $$;

-- Cambio de contraseña por el propio usuario. El backend ya verificó la contraseña actual y que la
-- nueva cumpla la política (aquí nunca llega en texto plano). Quita la obligación de cambiarla y el
-- trigger tg_usuario_revocar cierra todas sus sesiones (el backend abre una nueva a continuación).
CREATE OR REPLACE FUNCTION fn_cambiar_password(p_usuario bigint, p_nuevo_hash text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE usuario SET password_hash = p_nuevo_hash, debe_cambiar_password = false
   WHERE id = p_usuario AND activo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuario % no existe o está inactivo', p_usuario; END IF;
END $$;

-- =====================================================================
-- 9. FUNCIONES DE NEGOCIO
-- =====================================================================

-- Tipo de cambio vigente (el último registrado hasta esa fecha)
CREATE OR REPLACE FUNCTION fn_tipo_cambio_vigente(p_fecha date DEFAULT (now() AT TIME ZONE 'America/Managua')::date)
RETURNS numeric
LANGUAGE plpgsql STABLE AS $$
DECLARE v numeric;
BEGIN
  SELECT usd_a_nio INTO v FROM tipo_cambio WHERE fecha <= p_fecha ORDER BY fecha DESC LIMIT 1;
  IF v IS NULL THEN
    RAISE EXCEPTION 'No hay tipo de cambio registrado a la fecha %', p_fecha;
  END IF;
  RETURN v;
END $$;

-- Tipo de cambio de hoy (día de Managua). Se puede corregir durante el día: cada venta guarda el
-- tipo de cambio con que se cobró, así que el nuevo valor solo afecta a las ventas siguientes.
-- Los días anteriores no se editan.
CREATE OR REPLACE FUNCTION fn_set_tipo_cambio(p_usuario bigint, p_usd_a_nio numeric) RETURNS date
LANGUAGE plpgsql AS $$
DECLARE v_hoy date := (now() AT TIME ZONE 'America/Managua')::date;
BEGIN
  PERFORM fn_exigir_permiso(p_usuario, 'TIPO_CAMBIO_GESTIONAR');
  IF p_usd_a_nio IS NULL OR round(p_usd_a_nio, 4) <= 0 THEN
    RAISE EXCEPTION 'El tipo de cambio debe ser mayor que cero';
  END IF;
  INSERT INTO tipo_cambio (fecha, usd_a_nio, usuario_id)
  VALUES (v_hoy, round(p_usd_a_nio, 4), p_usuario)
  ON CONFLICT (fecha) DO UPDATE SET usd_a_nio = EXCLUDED.usd_a_nio, usuario_id = EXCLUDED.usuario_id;
  RETURN v_hoy;
END $$;

-- ---------------------------------------------------------------------
-- 9.1 Inventario
-- ---------------------------------------------------------------------
-- Entradas, ajustes y mermas. p_cantidad siempre positiva; el signo lo da el tipo.
CREATE OR REPLACE FUNCTION fn_movimiento_inventario(
  p_usuario bigint, p_sucursal integer, p_variante bigint, p_tipo text,
  p_cantidad integer, p_motivo text DEFAULT NULL, p_costo_unitario numeric DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_id bigint; v_signo int;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor que cero';
  END IF;

  CASE p_tipo
    WHEN 'ENTRADA'         THEN PERFORM fn_exigir_permiso(p_usuario, 'INVENTARIO_ENTRADA'); v_signo := 1;
    WHEN 'AJUSTE_POSITIVO' THEN PERFORM fn_exigir_permiso(p_usuario, 'INVENTARIO_AJUSTAR'); v_signo := 1;
    WHEN 'AJUSTE_NEGATIVO' THEN PERFORM fn_exigir_permiso(p_usuario, 'INVENTARIO_AJUSTAR'); v_signo := -1;
    WHEN 'MERMA'           THEN PERFORM fn_exigir_permiso(p_usuario, 'INVENTARIO_AJUSTAR'); v_signo := -1;
    ELSE RAISE EXCEPTION 'Tipo de movimiento no permitido aquí: % (ventas y traslados tienen su función)', p_tipo;
  END CASE;
  PERFORM fn_exigir_sucursal(p_usuario, p_sucursal);

  -- Toda la mercadería comprada entra por la bodega central
  IF p_tipo = 'ENTRADA' AND (SELECT tipo FROM sucursal WHERE id = p_sucursal) <> 'BODEGA' THEN
    RAISE EXCEPTION 'Las entradas de mercadería solo se registran en la bodega central; a las sucursales llega por envío';
  END IF;

  -- En una ENTRADA con costo informado se recalcula el costo promedio ponderado
  -- (con el stock ANTES de la entrada)
  IF p_tipo = 'ENTRADA' AND p_costo_unitario IS NOT NULL THEN
    UPDATE variante SET costo = fn_costo_promedio(p_variante, p_cantidad, p_costo_unitario)
     WHERE id = p_variante;
  END IF;

  INSERT INTO movimiento_inventario (sucursal_id, variante_id, tipo, cantidad, stock_resultante,
                                     costo_unitario, motivo, usuario_id)
  VALUES (p_sucursal, p_variante, p_tipo, v_signo * p_cantidad, 0,
          coalesce(p_costo_unitario, (SELECT costo FROM variante WHERE id = p_variante)),
          p_motivo, p_usuario)
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------
-- 9.2 Caja
-- ---------------------------------------------------------------------
-- Fondo que dejó el último cierre de la caja (lo que debería haber al abrir)
CREATE OR REPLACE FUNCTION fn_fondo_sugerido(p_caja integer)
RETURNS TABLE (fondo_nio numeric, fondo_usd numeric, turno_anterior bigint)
LANGUAGE sql STABLE AS $$
  SELECT t.fondo_siguiente_nio, t.fondo_siguiente_usd, t.id
    FROM turno_caja t
   WHERE t.caja_id = p_caja AND t.estado = 'CERRADO'
   ORDER BY t.fecha_cierre DESC
   LIMIT 1
$$;

-- Apertura: se declara el efectivo contado. Si no coincide con el fondo que dejó el cierre anterior,
-- la diferencia queda registrada y, si supera la tolerancia, se alerta al admin.
CREATE OR REPLACE FUNCTION fn_abrir_turno(
  p_usuario bigint, p_caja integer, p_inicial_nio numeric DEFAULT 0, p_inicial_usd numeric DEFAULT 0
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_id bigint; v_sucursal integer; v_f record; v_dif numeric;
BEGIN
  PERFORM fn_exigir_permiso(p_usuario, 'CAJA_ABRIR');
  SELECT sucursal_id INTO v_sucursal FROM caja WHERE id = p_caja AND activa;
  IF v_sucursal IS NULL THEN RAISE EXCEPTION 'La caja % no existe o está inactiva', p_caja; END IF;
  IF NOT (SELECT activa FROM sucursal WHERE id = v_sucursal) THEN
    RAISE EXCEPTION 'La sucursal de la caja % está inactiva', p_caja;
  END IF;
  PERFORM fn_exigir_sucursal(p_usuario, v_sucursal);
  IF EXISTS (SELECT 1 FROM turno_caja WHERE caja_id = p_caja AND estado = 'ABIERTO') THEN
    RAISE EXCEPTION 'La caja % ya tiene un turno abierto: ciérrelo antes de abrir otro', p_caja;
  END IF;

  SELECT * INTO v_f FROM fn_fondo_sugerido(p_caja);
  BEGIN
    INSERT INTO turno_caja (caja_id, usuario_apertura_id, monto_inicial_nio, monto_inicial_usd,
                            fondo_esperado_nio, fondo_esperado_usd)
    VALUES (p_caja, p_usuario, coalesce(p_inicial_nio, 0), coalesce(p_inicial_usd, 0),
            v_f.fondo_nio, v_f.fondo_usd)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'La caja % ya tiene un turno abierto', p_caja;
  END;

  IF v_f.turno_anterior IS NOT NULL THEN
    v_dif := (coalesce(p_inicial_nio, 0) - v_f.fondo_nio)
           + (coalesce(p_inicial_usd, 0) - v_f.fondo_usd) * fn_tipo_cambio_vigente();
    IF abs(v_dif) > coalesce(fn_parametro_num('CAJA_TOLERANCIA_DIFERENCIA_NIO'), 0) THEN
      INSERT INTO alerta (tipo, titulo, detalle, sucursal_id)
      VALUES ('CAJA_DIFERENCIA_APERTURA',
              format('Apertura con diferencia de C$ %s en %s', round(v_dif, 2), (SELECT nombre FROM sucursal WHERE id = v_sucursal)),
              jsonb_build_object('turno_id', v_id, 'turno_anterior', v_f.turno_anterior,
                                 'esperado_nio', v_f.fondo_nio, 'contado_nio', p_inicial_nio,
                                 'esperado_usd', v_f.fondo_usd, 'contado_usd', p_inicial_usd,
                                 'diferencia_total_nio', round(v_dif, 2), 'abierto_por', p_usuario),
              v_sucursal);
    END IF;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_movimiento_caja(
  p_usuario bigint, p_turno bigint, p_tipo text, p_moneda text, p_monto numeric, p_motivo text
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_id bigint; v_sucursal integer;
BEGIN
  PERFORM fn_exigir_permiso(p_usuario, 'CAJA_MOVIMIENTOS');
  SELECT c.sucursal_id INTO v_sucursal FROM turno_caja t JOIN caja c ON c.id = t.caja_id WHERE t.id = p_turno;
  PERFORM fn_exigir_sucursal(p_usuario, v_sucursal);
  INSERT INTO caja_movimiento (turno_id, tipo, moneda, monto, motivo, usuario_id)
  VALUES (p_turno, p_tipo, p_moneda, p_monto, p_motivo, p_usuario)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Monto esperado por método de pago y moneda para un turno
CREATE OR REPLACE FUNCTION fn_resumen_turno(p_turno bigint)
RETURNS TABLE (metodo_pago_id smallint, metodo text, moneda char(3), monto_esperado numeric)
LANGUAGE sql STABLE AS $$
  WITH efectivo AS (SELECT id FROM metodo_pago WHERE es_efectivo),
  partidas AS (
    SELECT (SELECT id FROM efectivo) AS mp, 'NIO'::char(3) AS mon, t.monto_inicial_nio AS monto
      FROM turno_caja t WHERE t.id = p_turno
    UNION ALL
    SELECT (SELECT id FROM efectivo), 'USD', t.monto_inicial_usd
      FROM turno_caja t WHERE t.id = p_turno
    UNION ALL
    SELECT vp.metodo_pago_id, vp.moneda, vp.monto
      FROM venta_pago vp JOIN venta v ON v.id = vp.venta_id
     WHERE v.turno_id = p_turno AND v.estado = 'COMPLETADA'
    UNION ALL
    SELECT (SELECT id FROM efectivo), cm.moneda,
           CASE cm.tipo WHEN 'INGRESO' THEN cm.monto ELSE -cm.monto END
      FROM caja_movimiento cm WHERE cm.turno_id = p_turno
  )
  SELECT p.mp, m.nombre::text, p.mon, sum(p.monto)
    FROM partidas p JOIN metodo_pago m ON m.id = p.mp
   GROUP BY p.mp, m.nombre, p.mon
   ORDER BY p.mp, p.mon
$$;

-- Cierre de turno (arqueo ciego).
--   p_efectivo:     conteo por denominación
--                   [{"moneda":"NIO","valor":1000,"cantidad":3}, {"moneda":"USD","valor":20,"cantidad":2}, ...]
--   p_no_efectivo:  totales de vouchers / transferencias [{"metodo":"TARJETA","monto":3100}, ...]
--   p_retiro_nio/usd: efectivo que se retira; lo que queda es el fondo del día siguiente
--   p_justificacion: obligatoria si la diferencia total supera CAJA_TOLERANCIA_DIFERENCIA_NIO.
--                    Quien cierra no ve montos: solo se le pide explicar.
-- Solo hay UN reconteo (con más, probando conteos se podría adivinar el monto esperado):
--   · Primer conteo que no cuadra y sin justificación → la caja NO se cierra: se anota el intento
--     (intentos_cierre) y se devuelve {"cerrado": false}. No es un error, para que el intento quede guardado.
--   · Desde el segundo conteo la justificación es obligatoria, cuadre o no, y la caja se cierra
--     con lo contado.
-- Al cerrar devuelve el ticket de cierre (fn_ticket_cierre) con "cerrado": true.
CREATE OR REPLACE FUNCTION fn_cerrar_turno(
  p_usuario        bigint,
  p_turno          bigint,
  p_efectivo       jsonb,
  p_no_efectivo    jsonb   DEFAULT '[]',
  p_retiro_nio     numeric DEFAULT 0,
  p_retiro_usd     numeric DEFAULT 0,
  p_justificacion  text    DEFAULT NULL,
  p_observaciones  text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_t record; v_sucursal integer; v_contado_nio numeric; v_contado_usd numeric;
  v_dif_total numeric; v_tol numeric; v_invalida text;
  v_justificada boolean := coalesce(length(trim(p_justificacion)), 0) >= 10;
BEGIN
  PERFORM fn_exigir_permiso(p_usuario, 'CAJA_CERRAR');
  SELECT t.*, c.sucursal_id AS suc INTO v_t
    FROM turno_caja t JOIN caja c ON c.id = t.caja_id
   WHERE t.id = p_turno
   FOR UPDATE OF t;                                 -- nadie más cierra/vende a la vez
  IF v_t.id IS NULL THEN RAISE EXCEPTION 'El turno % no existe', p_turno; END IF;
  IF v_t.estado <> 'ABIERTO' THEN RAISE EXCEPTION 'El turno % ya está cerrado', p_turno; END IF;
  v_sucursal := v_t.suc;
  PERFORM fn_exigir_sucursal(p_usuario, v_sucursal);

  -- Ya hubo un reconteo: se pide la justificación antes de mirar el conteo, para no decir si cuadra
  IF v_t.intentos_cierre > 0 AND NOT v_justificada THEN
    RAISE EXCEPTION 'Ya se hizo un reconteo: escriba una justificación (mínimo 10 caracteres) y la caja se cerrará con lo contado'
          USING ERRCODE = 'check_violation';
  END IF;

  -- Conteo por denominación
  SELECT string_agg(format('%s %s', x->>'moneda', x->>'valor'), ', ') INTO v_invalida
    FROM jsonb_array_elements(coalesce(p_efectivo, '[]'::jsonb)) x
   WHERE NOT EXISTS (SELECT 1 FROM denominacion d
                      WHERE d.moneda = upper(x->>'moneda') AND d.valor = (x->>'valor')::numeric AND d.activa)
      OR coalesce((x->>'cantidad')::integer, -1) < 0;
  IF v_invalida IS NOT NULL THEN RAISE EXCEPTION 'Denominación o cantidad inválida: %', v_invalida; END IF;

  -- Vouchers y transferencias: métodos que existen y no son efectivo (ese se cuenta por denominación)
  SELECT string_agg(DISTINCT coalesce(x->>'metodo', '(vacío)'), ', ') INTO v_invalida
    FROM jsonb_array_elements(coalesce(p_no_efectivo, '[]'::jsonb)) x
   WHERE NOT EXISTS (SELECT 1 FROM metodo_pago m WHERE m.codigo = upper(x->>'metodo') AND NOT m.es_efectivo)
      OR coalesce((x->>'monto')::numeric, -1) < 0;
  IF v_invalida IS NOT NULL THEN
    RAISE EXCEPTION 'Método de pago o monto inválido en el arqueo: %', v_invalida;
  END IF;

  BEGIN   -- si el conteo no cuadra y hay que recontar, lo guardado en este bloque se deshace
    INSERT INTO cierre_denominacion (turno_id, moneda, valor, cantidad)
    SELECT p_turno, upper(x->>'moneda'), (x->>'valor')::numeric, sum((x->>'cantidad')::integer)
      FROM jsonb_array_elements(coalesce(p_efectivo, '[]'::jsonb)) x
     GROUP BY 2, 3;

    SELECT coalesce(sum(valor * cantidad) FILTER (WHERE moneda = 'NIO'), 0),
           coalesce(sum(valor * cantidad) FILTER (WHERE moneda = 'USD'), 0)
      INTO v_contado_nio, v_contado_usd
      FROM cierre_denominacion WHERE turno_id = p_turno;

    IF coalesce(p_retiro_nio, 0) > v_contado_nio OR coalesce(p_retiro_usd, 0) > v_contado_usd THEN
      RAISE EXCEPTION 'No se puede retirar más efectivo del contado (C$ %, US$ %)', v_contado_nio, v_contado_usd;
    END IF;

    -- Esperado vs contado por método y moneda
    INSERT INTO cierre_caja_detalle (turno_id, metodo_pago_id, moneda, monto_esperado, monto_contado)
    SELECT p_turno,
           coalesce(e.metodo_pago_id, c.metodo_pago_id),
           coalesce(e.moneda, c.moneda),
           coalesce(e.monto_esperado, 0),
           coalesce(c.monto, 0)
      FROM fn_resumen_turno(p_turno) e
      FULL JOIN (
        SELECT (SELECT id FROM metodo_pago WHERE es_efectivo) AS metodo_pago_id, 'NIO'::char(3) AS moneda, v_contado_nio AS monto
        UNION ALL
        SELECT (SELECT id FROM metodo_pago WHERE es_efectivo), 'USD'::char(3), v_contado_usd
        UNION ALL
        SELECT m.id, 'NIO'::char(3), sum((x->>'monto')::numeric)
          FROM jsonb_array_elements(coalesce(p_no_efectivo, '[]'::jsonb)) x
          JOIN metodo_pago m ON m.codigo = upper(x->>'metodo') AND NOT m.es_efectivo
         GROUP BY m.id
      ) c ON c.metodo_pago_id = e.metodo_pago_id AND c.moneda = e.moneda
     WHERE coalesce(e.monto_esperado, 0) <> 0 OR coalesce(c.monto, 0) <> 0;

    SELECT coalesce(sum(CASE WHEN moneda = 'USD' THEN diferencia * fn_tipo_cambio_vigente() ELSE diferencia END), 0)
      INTO v_dif_total FROM cierre_caja_detalle WHERE turno_id = p_turno;
    v_tol := coalesce(fn_parametro_num('CAJA_TOLERANCIA_DIFERENCIA_NIO'), 0);

    IF abs(v_dif_total) > v_tol AND NOT v_justificada THEN
      RAISE EXCEPTION 'reconteo' USING ERRCODE = 'ESM01';
    END IF;
  EXCEPTION WHEN SQLSTATE 'ESM01' THEN
    UPDATE turno_caja SET intentos_cierre = intentos_cierre + 1 WHERE id = p_turno;
    RETURN jsonb_build_object('cerrado', false);
  END;

  IF abs(v_dif_total) > v_tol THEN
    INSERT INTO alerta (tipo, titulo, detalle, sucursal_id)
    VALUES ('CAJA_DIFERENCIA',
            format('Cierre con diferencia de C$ %s en %s', round(v_dif_total, 2), (SELECT nombre FROM sucursal WHERE id = v_sucursal)),
            jsonb_build_object('turno_id', p_turno, 'diferencia_total_nio', round(v_dif_total, 2),
                               'tolerancia_nio', v_tol, 'cerrado_por', p_usuario, 'justificacion', p_justificacion,
                               'hubo_reconteo', v_t.intentos_cierre > 0),
            v_sucursal);
  END IF;

  UPDATE turno_caja
     SET estado = 'CERRADO', fecha_cierre = now(), usuario_cierre_id = p_usuario,
         retiro_nio = coalesce(p_retiro_nio, 0), retiro_usd = coalesce(p_retiro_usd, 0),
         fondo_siguiente_nio = v_contado_nio - coalesce(p_retiro_nio, 0),
         fondo_siguiente_usd = v_contado_usd - coalesce(p_retiro_usd, 0),
         justificacion_diferencia = nullif(trim(p_justificacion), ''),
         observaciones = p_observaciones
   WHERE id = p_turno;

  UPDATE alerta SET atendida_por = p_usuario, atendida_at = now()
   WHERE tipo = 'CAJA_SIN_CERRAR' AND (detalle->>'turno_id')::bigint = p_turno AND atendida_at IS NULL;

  RETURN fn_ticket_cierre(p_turno, fn_tiene_permiso(p_usuario, 'CAJA_VER_DIFERENCIAS'))
         || jsonb_build_object('cerrado', true);
END $$;

-- Cierre forzado por el admin (nadie cerró). No hay conteo: se asume lo esperado, y la
-- diferencia real aparecerá al contar en la próxima apertura.
CREATE OR REPLACE FUNCTION fn_cierre_forzado(p_admin bigint, p_turno bigint, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_t record;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'CAJA_CIERRE_FORZADO');
  IF coalesce(length(trim(p_motivo)), 0) < 10 THEN RAISE EXCEPTION 'Indique el motivo del cierre forzado'; END IF;
  SELECT t.* INTO v_t FROM turno_caja t WHERE t.id = p_turno FOR UPDATE;
  IF v_t.id IS NULL OR v_t.estado <> 'ABIERTO' THEN RAISE EXCEPTION 'El turno % no está abierto', p_turno; END IF;

  INSERT INTO cierre_caja_detalle (turno_id, metodo_pago_id, moneda, monto_esperado, monto_contado)
  SELECT p_turno, e.metodo_pago_id, e.moneda, e.monto_esperado, e.monto_esperado
    FROM fn_resumen_turno(p_turno) e
   WHERE e.monto_esperado <> 0;

  UPDATE turno_caja
     SET estado = 'CERRADO', fecha_cierre = now(), usuario_cierre_id = p_admin, cierre_forzado = true,
         retiro_nio = 0, retiro_usd = 0,
         fondo_siguiente_nio = coalesce((SELECT monto_esperado FROM fn_resumen_turno(p_turno) r
                                          JOIN metodo_pago m ON m.id = r.metodo_pago_id
                                         WHERE m.es_efectivo AND r.moneda = 'NIO'), 0),
         fondo_siguiente_usd = coalesce((SELECT monto_esperado FROM fn_resumen_turno(p_turno) r
                                          JOIN metodo_pago m ON m.id = r.metodo_pago_id
                                         WHERE m.es_efectivo AND r.moneda = 'USD'), 0),
         observaciones = 'Cierre forzado: ' || p_motivo
   WHERE id = p_turno;

  UPDATE alerta SET atendida_por = p_admin, atendida_at = now()
   WHERE tipo = 'CAJA_SIN_CERRAR' AND (detalle->>'turno_id')::bigint = p_turno AND atendida_at IS NULL;
  RETURN fn_ticket_cierre(p_turno, true);
END $$;

-- Para ejecutar periódicamente (tarea programada del backend, p. ej. cada 15 min):
-- genera una alerta por cada turno abierto después de la hora CAJA_HORA_ALERTA_CIERRE de su día,
-- o abierto desde un día anterior. Una sola alerta por turno.
CREATE OR REPLACE FUNCTION fn_alertar_cajas_sin_cerrar(p_ahora timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n integer; v_hora time := coalesce(fn_parametro_txt('CAJA_HORA_ALERTA_CIERRE'), '21:30')::time;
BEGIN
  INSERT INTO alerta (tipo, titulo, detalle, sucursal_id)
  SELECT 'CAJA_SIN_CERRAR',
         format('%s: la caja sigue abierta (abierta el %s)', s.nombre,
                to_char(t.fecha_apertura AT TIME ZONE 'America/Managua', 'DD/MM HH24:MI')),
         jsonb_build_object('turno_id', t.id, 'caja_id', t.caja_id), s.id
    FROM turno_caja t
    JOIN caja c ON c.id = t.caja_id
    JOIN sucursal s ON s.id = c.sucursal_id
   WHERE t.estado = 'ABIERTO'
     AND ( (p_ahora AT TIME ZONE 'America/Managua')::date > (t.fecha_apertura AT TIME ZONE 'America/Managua')::date
        OR (p_ahora AT TIME ZONE 'America/Managua')::time >= v_hora )
     AND NOT EXISTS (SELECT 1 FROM alerta a WHERE a.tipo = 'CAJA_SIN_CERRAR' AND (a.detalle->>'turno_id')::bigint = t.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Ticket de cierre (se imprime). Nunca muestra montos esperados ni diferencias.
--   · Quien cierra recibe solo lo que contó, lo que retiró y el fondo que dejó: con lo vendido o lo
--     cobrado por método podría deducir cuánto se esperaba.
--   · p_completo (para quien tiene CAJA_VER_DIFERENCIAS) agrega las ventas y lo cobrado por método.
--   En un cierre forzado no hubo conteo (se asumió lo esperado): el ticket reducido no trae montos.
CREATE OR REPLACE FUNCTION fn_ticket_cierre(p_turno bigint, p_completo boolean DEFAULT false)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'turno_id', t.id,
    'sucursal', s.nombre,
    'caja', c.nombre,
    'abierto_por', ua.nombre_completo,
    'apertura', t.fecha_apertura,
    'cerrado_por', uc.nombre_completo,
    'cierre', t.fecha_cierre,
    'cierre_forzado', t.cierre_forzado)
  || CASE WHEN t.cierre_forzado AND NOT p_completo THEN '{}'::jsonb ELSE jsonb_build_object(
    'contado', (SELECT coalesce(jsonb_agg(jsonb_build_object('metodo', m.nombre, 'moneda', d.moneda, 'monto', d.monto_contado)
                                         ORDER BY m.id, d.moneda), '[]'::jsonb)
                  FROM cierre_caja_detalle d JOIN metodo_pago m ON m.id = d.metodo_pago_id
                 WHERE d.turno_id = t.id AND d.monto_contado <> 0),
    'retiro_nio', t.retiro_nio, 'retiro_usd', t.retiro_usd,
    'fondo_siguiente_nio', t.fondo_siguiente_nio, 'fondo_siguiente_usd', t.fondo_siguiente_usd) END
  || CASE WHEN NOT p_completo THEN '{}'::jsonb ELSE jsonb_build_object(
    'ventas', (SELECT count(*) FROM venta v WHERE v.turno_id = t.id AND v.estado = 'COMPLETADA'),
    'anuladas', (SELECT count(*) FROM venta v WHERE v.turno_id = t.id AND v.estado = 'ANULADA'),
    'total_vendido', (SELECT coalesce(sum(total), 0) FROM venta v WHERE v.turno_id = t.id AND v.estado = 'COMPLETADA'),
    'descuentos_promociones', (SELECT coalesce(sum(descuento), 0) FROM venta v WHERE v.turno_id = t.id AND v.estado = 'COMPLETADA'),
    'cobros', (SELECT coalesce(jsonb_agg(jsonb_build_object('metodo', q.metodo, 'moneda', q.moneda, 'monto', q.monto) ORDER BY q.metodo, q.moneda), '[]'::jsonb)
                 FROM (SELECT m.nombre AS metodo, vp.moneda, sum(vp.monto) AS monto
                         FROM venta_pago vp JOIN venta v ON v.id = vp.venta_id AND v.estado = 'COMPLETADA'
                         JOIN metodo_pago m ON m.id = vp.metodo_pago_id
                        WHERE v.turno_id = t.id GROUP BY m.nombre, vp.moneda) q)) END
  FROM turno_caja t
  JOIN caja c ON c.id = t.caja_id
  JOIN sucursal s ON s.id = c.sucursal_id
  JOIN usuario ua ON ua.id = t.usuario_apertura_id
  LEFT JOIN usuario uc ON uc.id = t.usuario_cierre_id
  WHERE t.id = p_turno
$$;

-- ---------------------------------------------------------------------
-- 9.2b Caja y turno de una sesión (POS)
--   La caja con la que alguien trabaja NO la manda la pantalla: sale del equipo registrado en el
--   que inició sesión.
--     · PC de caja            → su caja.
--     · Tablet o celular      → para vender, mover efectivo o cerrar: la única caja de su sucursal
--                               con turno abierto (NULL si ninguna); para abrir (p_abrir): la única
--                               caja activa de su sucursal.
--     · Sin equipo registrado → solo el administrador entra así, y tiene que indicar la caja.
--   Elegir la caja (p_caja) es solo para el administrador, y solo si su equipo no tiene una propia.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_caja_de_sesion(
  p_usuario bigint, p_dispositivo uuid, p_caja integer DEFAULT NULL, p_abrir boolean DEFAULT false
) RETURNS integer
LANGUAGE plpgsql STABLE AS $$
DECLARE
  d        dispositivo%ROWTYPE;
  v_admin  boolean := fn_equipo_autorizado(p_usuario, NULL);   -- solo el admin entra sin equipo
  v_cajas  integer[];
  v_suc    text;
BEGIN
  IF NOT fn_equipo_autorizado(p_usuario, p_dispositivo) THEN
    RAISE EXCEPTION 'Esta operación se hace desde un equipo registrado y activo de la sucursal'
          USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO d FROM dispositivo WHERE id = p_dispositivo;

  IF d.caja_id IS NOT NULL THEN
    IF p_caja IS NOT NULL AND p_caja <> d.caja_id THEN
      RAISE EXCEPTION 'Este equipo trabaja con su propia caja: no se puede elegir otra';
    END IF;
    RETURN d.caja_id;
  END IF;

  IF p_caja IS NOT NULL THEN
    IF NOT v_admin THEN
      RAISE EXCEPTION 'Solo el administrador puede elegir la caja' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM caja WHERE id = p_caja) THEN
      RAISE EXCEPTION 'La caja % no existe', p_caja;
    END IF;
    RETURN p_caja;
  END IF;

  IF d.id IS NULL THEN
    RAISE EXCEPTION 'Indique la caja: esta sesión no es de un equipo registrado';
  END IF;

  -- Tablet o celular: la caja de su sucursal
  SELECT nombre INTO v_suc FROM sucursal WHERE id = d.sucursal_id;
  IF p_abrir THEN
    SELECT array_agg(id) INTO v_cajas FROM caja WHERE sucursal_id = d.sucursal_id AND activa;
    IF v_cajas IS NULL THEN RAISE EXCEPTION '% no tiene una caja activa', v_suc; END IF;
    IF cardinality(v_cajas) > 1 THEN
      RAISE EXCEPTION '% tiene más de una caja: abra el turno desde la PC de la caja', v_suc;
    END IF;
  ELSE
    SELECT array_agg(c.id) INTO v_cajas
      FROM caja c JOIN turno_caja t ON t.caja_id = c.id AND t.estado = 'ABIERTO'
     WHERE c.sucursal_id = d.sucursal_id;
    IF cardinality(v_cajas) > 1 THEN
      RAISE EXCEPTION '% tiene más de una caja abierta: haga esta operación desde la PC de la caja', v_suc;
    END IF;
  END IF;
  RETURN v_cajas[1];   -- NULL: ninguna caja de la sucursal tiene turno abierto
END $$;

-- Turno abierto con el que trabaja una sesión (NULL si su caja no tiene turno abierto)
CREATE OR REPLACE FUNCTION fn_turno_de_sesion(p_usuario bigint, p_dispositivo uuid, p_caja integer DEFAULT NULL)
RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT t.id FROM turno_caja t
   WHERE t.caja_id = (SELECT fn_caja_de_sesion(p_usuario, p_dispositivo, p_caja)) AND t.estado = 'ABIERTO'
$$;

-- ---------------------------------------------------------------------
-- 9.3 Ventas
-- ---------------------------------------------------------------------
-- p_items:  [{"variante_id": 12, "cantidad": 1},                       ← pieza o servicio
--            {"variante_id": 12, "cantidad": 1, "precio": 700},        ← precio subido (nunca menor)
--            {"variante_id": 40, "cantidad": 1, "piezas": [21]}]       ← paquete: perforación + pieza(s) escaneadas
-- p_pagos:  [{"metodo":"EFECTIVO","moneda":"USD","monto":20},
--            {"metodo":"TARJETA","moneda":"NIO","monto":350,"referencia":"784512"}]
-- p_promocion:    id de una promoción activa y vigente (opcional). Es la única forma de cobrar menos.
-- p_idempotencia: UUID que genera el POS por cada venta. Si llega dos veces (doble clic, reintento de red)
--                 se devuelve la misma venta en lugar de crear otra.
-- Reglas:
-- · El precio de lista lo pone la BD: precio_venta de la variante, o fn_precio_paquete para un paquete.
--   "precio" es opcional: igual o mayor a la lista, nunca menor, y como máximo +VENTA_SOBREPRECIO_MAX_PCT.
-- · Un paquete va con cantidad 1 y descuenta del inventario cada pieza escaneada.
-- · El costo sale de la BD (paquete = costo del servicio + costo de las piezas).
-- · Si lo pagado supera el total y hay efectivo, el exceso se registra como vuelto en C$.
CREATE OR REPLACE FUNCTION fn_registrar_venta(
  p_usuario           bigint,
  p_turno             bigint,
  p_items             jsonb,
  p_pagos             jsonb,
  p_promocion         integer DEFAULT NULL,
  p_cliente_nombre    text    DEFAULT NULL,
  p_cliente_telefono  text    DEFAULT NULL,
  p_notas             text    DEFAULT NULL,
  p_idempotencia      uuid    DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_sucursal    integer;
  v_estado      text;
  v_tc          numeric;
  v_numero      text;
  v_venta_id    bigint;
  v_det_id      bigint;
  v_subtotal    numeric;
  v_descuento   numeric := 0;
  v_total       numeric;
  v_pagado      numeric;
  v_efectivo    numeric;
  v_exceso      numeric;
  v_efectivo_id smallint;
  v_lista       text;
  v_max_pct     numeric;
  v_precio_paq  numeric;
  v_costo_paq   numeric;
  v_promo       record;
  v_hoy         date := (now() AT TIME ZONE 'America/Managua')::date;
  r             record;
  pz            record;
BEGIN
  -- Venta ya registrada con esta clave → se devuelve la misma
  IF p_idempotencia IS NOT NULL THEN
    SELECT id INTO v_venta_id FROM venta WHERE clave_idempotencia = p_idempotencia;
    IF FOUND THEN RETURN v_venta_id; END IF;
  END IF;

  PERFORM fn_exigir_permiso(p_usuario, 'VENTAS_REGISTRAR');

  SELECT t.estado, c.sucursal_id INTO v_estado, v_sucursal
    FROM turno_caja t JOIN caja c ON c.id = t.caja_id WHERE t.id = p_turno;
  IF v_estado IS DISTINCT FROM 'ABIERTO' THEN
    RAISE EXCEPTION 'No hay un turno abierto con id %', p_turno;
  END IF;
  PERFORM fn_exigir_sucursal(p_usuario, v_sucursal);

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta debe tener al menos un producto';
  END IF;
  IF p_pagos IS NULL OR jsonb_typeof(p_pagos) <> 'array' OR jsonb_array_length(p_pagos) = 0 THEN
    RAISE EXCEPTION 'La venta debe tener al menos un pago';
  END IF;

  -- 1. Líneas normalizadas
  IF to_regclass('pg_temp.tmp_linea') IS NULL THEN
  CREATE TEMP TABLE tmp_linea (
    n               integer PRIMARY KEY,
    variante_id     bigint,
    cantidad        integer,
    precio_enviado  numeric,
    piezas          bigint[],
    tipo            text,
    nombre          text,
    activo          boolean,
    perforacion_id  integer,
    precio_lista    numeric,
    precio_cobrado  numeric,
    costo           numeric
  ) ON COMMIT DROP;
  END IF;
  TRUNCATE tmp_linea;

  INSERT INTO tmp_linea (n, variante_id, cantidad, precio_enviado, piezas)
  SELECT t.ord, (t.x->>'variante_id')::bigint, (t.x->>'cantidad')::integer,
         round((t.x->>'precio')::numeric, 2),
         CASE WHEN jsonb_typeof(t.x->'piezas') = 'array'
              THEN ARRAY(SELECT jsonb_array_elements_text(t.x->'piezas')::bigint) END
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(x, ord);

  UPDATE tmp_linea l
     SET tipo = pr.tipo, nombre = pr.nombre || ' — ' || va.nombre, activo = va.activo AND pr.activo,
         perforacion_id = pf.id, precio_lista = va.precio_venta, costo = va.costo
    FROM variante va
    JOIN producto pr ON pr.id = va.producto_id
    LEFT JOIN perforacion pf ON pf.paquete_variante_id = va.id
   WHERE va.id = l.variante_id;

  -- 2. Validación por línea y precio de lista de los paquetes
  FOR r IN SELECT * FROM tmp_linea ORDER BY n LOOP
    IF r.tipo IS NULL THEN RAISE EXCEPTION 'Variante inexistente: %', coalesce(r.variante_id::text, '(vacía)'); END IF;
    IF NOT r.activo THEN RAISE EXCEPTION 'El producto "%" está inactivo', r.nombre; END IF;
    IF r.cantidad IS NULL OR r.cantidad <= 0 THEN RAISE EXCEPTION 'Cantidad inválida para "%"', r.nombre; END IF;

    IF r.tipo = 'PAQUETE' THEN
      IF r.cantidad <> 1 THEN
        RAISE EXCEPTION 'Cada paquete "%" se registra como una línea con cantidad 1', r.nombre;
      END IF;
      IF r.piezas IS NULL OR cardinality(r.piezas) = 0 THEN
        RAISE EXCEPTION 'El paquete "%" requiere escanear la(s) pieza(s)', r.nombre;
      END IF;
      SELECT pp.precio INTO v_precio_paq FROM fn_precio_paquete(r.perforacion_id, r.piezas) pp;
      SELECT sv.costo + (SELECT sum(va.costo) FROM unnest(r.piezas) AS u(id) JOIN variante va ON va.id = u.id)
        INTO v_costo_paq
        FROM perforacion pf JOIN variante sv ON sv.id = pf.servicio_variante_id
       WHERE pf.id = r.perforacion_id;
      UPDATE tmp_linea SET precio_lista = v_precio_paq, costo = v_costo_paq WHERE n = r.n;
    ELSIF r.piezas IS NOT NULL THEN
      RAISE EXCEPTION 'Solo los paquetes llevan piezas ("%")', r.nombre;
    END IF;
  END LOOP;

  UPDATE tmp_linea SET precio_cobrado = coalesce(precio_enviado, precio_lista);

  -- 3. El precio solo sube: nunca menor que la lista; mayor requiere permiso y respeta el tope
  SELECT string_agg(format('"%s" C$ %s (establecido C$ %s)', nombre, precio_cobrado, precio_lista), '; ' ORDER BY n)
    INTO v_lista FROM tmp_linea WHERE precio_cobrado < precio_lista;
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'El precio de venta no puede ser menor al establecido: %', v_lista
          USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM tmp_linea WHERE precio_cobrado > precio_lista) THEN
    PERFORM fn_exigir_permiso(p_usuario, 'VENTAS_MODIFICAR_PRECIO');
    v_max_pct := fn_parametro_num('VENTA_SOBREPRECIO_MAX_PCT');
    IF v_max_pct IS NOT NULL THEN
      SELECT string_agg(format('"%s" C$ %s (máximo C$ %s)', nombre, precio_cobrado,
                               round(precio_lista * (1 + v_max_pct / 100), 2)), '; ' ORDER BY n)
        INTO v_lista FROM tmp_linea
       WHERE precio_cobrado > round(precio_lista * (1 + v_max_pct / 100), 2);
      IF v_lista IS NOT NULL THEN
        RAISE EXCEPTION 'El precio supera el aumento máximo permitido (+% %%): %', v_max_pct, v_lista;
      END IF;
    END IF;
  END IF;

  SELECT sum(cantidad * precio_cobrado) INTO v_subtotal FROM tmp_linea;

  -- 4. Promoción (una por venta, sobre toda la venta)
  IF p_promocion IS NOT NULL THEN
    PERFORM fn_exigir_permiso(p_usuario, 'VENTAS_PROMOCION');
    SELECT * INTO v_promo FROM promocion WHERE id = p_promocion;
    IF v_promo.id IS NULL THEN RAISE EXCEPTION 'La promoción % no existe', p_promocion; END IF;
    IF NOT v_promo.activa THEN RAISE EXCEPTION 'La promoción "%" no está activa', v_promo.nombre; END IF;
    IF (v_promo.vigente_desde IS NOT NULL AND v_hoy < v_promo.vigente_desde)
       OR (v_promo.vigente_hasta IS NOT NULL AND v_hoy > v_promo.vigente_hasta) THEN
      RAISE EXCEPTION 'La promoción "%" no está vigente hoy', v_promo.nombre;
    END IF;
    IF v_subtotal < v_promo.compra_minima THEN
      RAISE EXCEPTION 'La promoción "%" requiere una compra mínima de C$ % (la venta suma C$ %)',
            v_promo.nombre, v_promo.compra_minima, v_subtotal;
    END IF;
    v_descuento := CASE v_promo.tipo WHEN 'PORCENTAJE' THEN round(v_subtotal * v_promo.valor / 100, 2)
                                     ELSE least(v_promo.valor, v_subtotal) END;
  END IF;
  v_total := v_subtotal - v_descuento;

  -- 5. Correlativo por sucursal. El bloqueo de la fila serializa las ventas de la sucursal;
  --    con él tomado se vuelve a revisar la clave (otra petición igual pudo terminar mientras tanto).
  PERFORM 1 FROM sucursal WHERE id = v_sucursal FOR UPDATE;
  IF p_idempotencia IS NOT NULL THEN
    SELECT id INTO v_venta_id FROM venta WHERE clave_idempotencia = p_idempotencia;
    IF FOUND THEN RETURN v_venta_id; END IF;
  END IF;
  UPDATE sucursal SET ultimo_numero_venta = ultimo_numero_venta + 1
   WHERE id = v_sucursal
  RETURNING codigo || '-' || lpad(ultimo_numero_venta::text, 8, '0') INTO v_numero;

  v_tc := fn_tipo_cambio_vigente();

  INSERT INTO venta (numero, sucursal_id, turno_id, vendedor_id, cliente_nombre, cliente_telefono,
                     subtotal, descuento, total, tipo_cambio, notas, promocion_id, clave_idempotencia)
  VALUES (v_numero, v_sucursal, p_turno, p_usuario, p_cliente_nombre, p_cliente_telefono,
          v_subtotal, v_descuento, v_total, v_tc, p_notas, p_promocion, p_idempotencia)
  RETURNING id INTO v_venta_id;

  -- 6. Detalle y salida de inventario (piezas sueltas y piezas de paquetes)
  FOR r IN SELECT * FROM tmp_linea ORDER BY variante_id, n LOOP
    INSERT INTO venta_detalle (venta_id, variante_id, cantidad, precio_lista, precio_unitario, costo_unitario)
    VALUES (v_venta_id, r.variante_id, r.cantidad, r.precio_lista, r.precio_cobrado, r.costo)
    RETURNING id INTO v_det_id;

    IF r.tipo = 'PRODUCTO' THEN
      INSERT INTO movimiento_inventario (sucursal_id, variante_id, tipo, cantidad, stock_resultante,
                                         costo_unitario, venta_id, usuario_id)
      VALUES (v_sucursal, r.variante_id, 'VENTA', -r.cantidad, 0, r.costo, v_venta_id, p_usuario);
    ELSIF r.tipo = 'PAQUETE' THEN
      FOR pz IN SELECT u.id, count(*)::integer AS cant, va.costo
                  FROM unnest(r.piezas) AS u(id) JOIN variante va ON va.id = u.id
                 GROUP BY u.id, va.costo ORDER BY u.id
      LOOP
        INSERT INTO venta_detalle_pieza (venta_detalle_id, variante_id, cantidad, costo_unitario)
        VALUES (v_det_id, pz.id, pz.cant, pz.costo);
        INSERT INTO movimiento_inventario (sucursal_id, variante_id, tipo, cantidad, stock_resultante,
                                           costo_unitario, venta_id, motivo, usuario_id)
        VALUES (v_sucursal, pz.id, 'VENTA', -pz.cant, 0, pz.costo, v_venta_id,
                left('Pieza de paquete: ' || r.nombre, 200), p_usuario);
      END LOOP;
    END IF;
  END LOOP;

  -- 7. Pagos
  FOR r IN
    SELECT m.id AS metodo_id, m.codigo, m.requiere_referencia, m.es_efectivo, m.activo,
           upper(coalesce(x->>'moneda', 'NIO'))::char(3) AS moneda,
           (x->>'monto')::numeric AS monto,
           nullif(trim(x->>'referencia'), '') AS referencia,
           x->>'metodo' AS metodo_txt
      FROM jsonb_array_elements(p_pagos) x
      LEFT JOIN metodo_pago m ON m.codigo = upper(x->>'metodo')
  LOOP
    IF r.metodo_id IS NULL OR NOT r.activo THEN
      RAISE EXCEPTION 'Método de pago inválido: %', r.metodo_txt;
    END IF;
    IF r.monto IS NULL OR r.monto <= 0 THEN
      RAISE EXCEPTION 'El monto de cada pago debe ser mayor que cero';
    END IF;
    IF r.requiere_referencia AND r.referencia IS NULL THEN
      RAISE EXCEPTION 'El pago con % requiere número de referencia', r.codigo;
    END IF;
    INSERT INTO venta_pago (venta_id, metodo_pago_id, moneda, monto, tipo_cambio, referencia)
    VALUES (v_venta_id, r.metodo_id, r.moneda, r.monto,
            CASE WHEN r.moneda = 'USD' THEN v_tc ELSE 1 END, r.referencia);
  END LOOP;

  -- 8. Cuadre y vuelto
  SELECT sum(vp.monto_nio), sum(vp.monto_nio) FILTER (WHERE m.es_efectivo)
    INTO v_pagado, v_efectivo
    FROM venta_pago vp JOIN metodo_pago m ON m.id = vp.metodo_pago_id
   WHERE vp.venta_id = v_venta_id;

  IF v_pagado < v_total THEN
    RAISE EXCEPTION 'Pago insuficiente: total C$ %, pagado C$ %', v_total, v_pagado;
  END IF;

  v_exceso := v_pagado - v_total;
  IF v_exceso > 0 THEN
    IF coalesce(v_efectivo, 0) < v_exceso THEN
      RAISE EXCEPTION 'Los pagos con tarjeta/transferencia exceden el total (exceso C$ %)', v_exceso;
    END IF;
    SELECT id INTO v_efectivo_id FROM metodo_pago WHERE es_efectivo;
    INSERT INTO venta_pago (venta_id, metodo_pago_id, moneda, monto, tipo_cambio, es_vuelto)
    VALUES (v_venta_id, v_efectivo_id, 'NIO', -v_exceso, 1, true);
  END IF;

  RETURN v_venta_id;
END $$;

-- Promociones (panel del admin)
CREATE OR REPLACE FUNCTION fn_guardar_promocion(
  p_admin bigint, p_id integer, p_nombre text, p_tipo text, p_valor numeric,
  p_compra_minima numeric DEFAULT 0, p_desde date DEFAULT NULL, p_hasta date DEFAULT NULL,
  p_descripcion text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v_id integer;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'PROMOCIONES_GESTIONAR');
  IF p_id IS NULL THEN
    INSERT INTO promocion (nombre, descripcion, tipo, valor, compra_minima, vigente_desde, vigente_hasta, created_by)
    VALUES (trim(p_nombre), p_descripcion, upper(p_tipo), p_valor, coalesce(p_compra_minima, 0), p_desde, p_hasta, p_admin)
    RETURNING id INTO v_id;
  ELSE
    UPDATE promocion
       SET nombre = trim(p_nombre), descripcion = p_descripcion, tipo = upper(p_tipo), valor = p_valor,
           compra_minima = coalesce(p_compra_minima, 0), vigente_desde = p_desde, vigente_hasta = p_hasta
     WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'La promoción % no existe', p_id; END IF;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_set_promocion_activa(p_admin bigint, p_id integer, p_activa boolean)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'PROMOCIONES_GESTIONAR');
  UPDATE promocion SET activa = p_activa WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'La promoción % no existe', p_id; END IF;
END $$;

-- Lista para el botón "Promoción" del POS: activas y vigentes hoy, con cuánto descontarían
CREATE OR REPLACE FUNCTION fn_promociones_disponibles(p_subtotal numeric DEFAULT NULL)
RETURNS TABLE (promocion_id integer, nombre text, tipo text, valor numeric, compra_minima numeric,
               aplica boolean, descuento numeric)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.nombre::text, p.tipo::text, p.valor, p.compra_minima,
         p_subtotal IS NULL OR p_subtotal >= p.compra_minima,
         CASE WHEN p_subtotal IS NULL THEN NULL
              WHEN p.tipo = 'PORCENTAJE' THEN round(p_subtotal * p.valor / 100, 2)
              ELSE least(p.valor, p_subtotal) END
    FROM promocion p
   WHERE p.activa
     AND (p.vigente_desde IS NULL OR p.vigente_desde <= (now() AT TIME ZONE 'America/Managua')::date)
     AND (p.vigente_hasta IS NULL OR p.vigente_hasta >= (now() AT TIME ZONE 'America/Managua')::date)
   ORDER BY p.nombre
$$;

-- Anulación: solo con el turno aún abierto (después del cierre → devolución, fase 2)
CREATE OR REPLACE FUNCTION fn_anular_venta(p_usuario bigint, p_venta bigint, p_motivo text)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v record;
BEGIN
  PERFORM fn_exigir_permiso(p_usuario, 'VENTAS_ANULAR');

  SELECT ve.*, t.estado AS estado_turno INTO v
    FROM venta ve JOIN turno_caja t ON t.id = ve.turno_id
   WHERE ve.id = p_venta
   FOR UPDATE OF ve;
  IF v.id IS NULL THEN RAISE EXCEPTION 'La venta % no existe', p_venta; END IF;
  IF v.estado = 'ANULADA' THEN RAISE EXCEPTION 'La venta % ya está anulada', v.numero; END IF;
  IF v.estado_turno <> 'ABIERTO' THEN
    RAISE EXCEPTION 'La venta % pertenece a un turno cerrado; registre una devolución', v.numero;
  END IF;
  PERFORM fn_exigir_sucursal(p_usuario, v.sucursal_id);

  UPDATE venta
     SET estado = 'ANULADA', anulada_por = p_usuario, fecha_anulacion = now(), motivo_anulacion = p_motivo
   WHERE id = p_venta;

  -- Devolver el stock (misma cantidad y costo con que salió)
  INSERT INTO movimiento_inventario (sucursal_id, variante_id, tipo, cantidad, stock_resultante,
                                     costo_unitario, venta_id, motivo, usuario_id)
  SELECT m.sucursal_id, m.variante_id, 'ANULACION_VENTA', -m.cantidad, 0, m.costo_unitario,
         m.venta_id, 'Anulación ' || v.numero, p_usuario
    FROM movimiento_inventario m
   WHERE m.venta_id = p_venta AND m.tipo = 'VENTA'
   ORDER BY m.variante_id;
END $$;

-- Búsqueda para el POS: por nombre, SKU o código de barras, con stock de la sucursal
CREATE OR REPLACE FUNCTION fn_buscar_variantes(p_texto text, p_sucursal integer, p_limite int DEFAULT 20)
RETURNS TABLE (variante_id bigint, sku text, codigo_barras text, producto text, variante text,
               categoria text, tipo text, precio numeric, stock integer, gama text, foto_url text)
LANGUAGE sql STABLE AS $$
  SELECT va.id, va.sku::text, va.codigo_barras::text, p.nombre::text, va.nombre::text,
         c.nombre::text, p.tipo::text,
         CASE WHEN p.tipo = 'PAQUETE' THEN NULL ELSE va.precio_venta END,   -- el paquete se calcula con la pieza
         CASE WHEN p.tipo = 'PRODUCTO' THEN coalesce(s.cantidad, 0) END,
         g.nombre::text, va.foto_url::text
    FROM variante va
    JOIN producto p  ON p.id = va.producto_id
    JOIN categoria c ON c.id = p.categoria_id
    LEFT JOIN gama g ON g.id = va.gama_id
    LEFT JOIN stock_sucursal s ON s.variante_id = va.id AND s.sucursal_id = p_sucursal
   WHERE va.activo AND p.activo
     AND ( va.codigo_barras = p_texto
        OR upper(va.sku) = upper(p_texto)
        OR lower(p.nombre || ' ' || va.nombre) LIKE '%' || lower(p_texto) || '%')
   ORDER BY (va.codigo_barras = p_texto OR upper(va.sku) = upper(p_texto)) DESC NULLS LAST,
            p.nombre, va.nombre
   LIMIT p_limite
$$;

-- ¿Ve el usuario la cantidad exacta que hay en la bodega? Sin el permiso INVENTARIO_VER_BODEGA
-- depende del parámetro BODEGA_VISIBILIDAD: 'SI_NO' (solo sabe si hay o no) o 'CANTIDAD'.
CREATE OR REPLACE FUNCTION fn_ve_cantidad_bodega(p_usuario bigint) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT fn_tiene_permiso(p_usuario, 'INVENTARIO_VER_BODEGA')
      OR coalesce(fn_parametro_txt('BODEGA_VISIBILIDAD'), 'SI_NO') = 'CANTIDAD'
$$;

-- Existencias de una variante en cada ubicación, según lo que el usuario puede ver
-- (la cantidad de la bodega, solo si fn_ve_cantidad_bodega).
CREATE OR REPLACE FUNCTION fn_consultar_stock(p_usuario bigint, p_variante bigint)
RETURNS TABLE (sucursal_id integer, sucursal text, tipo text, cantidad integer, disponible boolean)
LANGUAGE sql STABLE AS $$
  SELECT s.id, s.nombre::text, s.tipo::text,
         CASE WHEN s.tipo = 'BODEGA' AND NOT fn_ve_cantidad_bodega(p_usuario)
              THEN NULL
              ELSE coalesce(ss.cantidad, 0) END,
         coalesce(ss.cantidad, 0) > 0
    FROM sucursal s
    LEFT JOIN stock_sucursal ss ON ss.sucursal_id = s.id AND ss.variante_id = p_variante
   WHERE s.activa
     AND fn_tiene_permiso(p_usuario, 'INVENTARIO_VER')
   ORDER BY s.tipo DESC, s.nombre
$$;

-- ---------------------------------------------------------------------
-- 9.3b Equipos autorizados
--   El backend genera un token aleatorio, lo entrega UNA vez al equipo y guarda
--   solo su SHA-256. En cada inicio de sesión el equipo presenta el token.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_registrar_dispositivo(
  p_admin bigint, p_nombre text, p_tipo text, p_sucursal integer,
  p_token_hash text, p_caja integer DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'SUCURSALES_GESTIONAR');
  INSERT INTO dispositivo (nombre, tipo, sucursal_id, caja_id, token_hash, registrado_por)
  VALUES (trim(p_nombre), upper(p_tipo), p_sucursal, p_caja, p_token_hash, p_admin)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Identifica el equipo por su token. NULL si no existe o está desactivado.
CREATE OR REPLACE FUNCTION fn_dispositivo_por_token(p_token_hash text)
RETURNS TABLE (dispositivo_id uuid, nombre text, tipo text, sucursal_id integer, caja_id integer)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
    UPDATE dispositivo d SET ultimo_uso = now()
     WHERE d.token_hash = p_token_hash AND d.activo
    RETURNING d.id, d.nombre::text, d.tipo::text, d.sucursal_id, d.caja_id;
END $$;

CREATE OR REPLACE FUNCTION fn_set_dispositivo_activo(p_admin bigint, p_dispositivo uuid, p_activo boolean)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'SUCURSALES_GESTIONAR');
  UPDATE dispositivo SET activo = p_activo WHERE id = p_dispositivo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Equipo % no existe', p_dispositivo; END IF;
END $$;

-- ---------------------------------------------------------------------
-- 9.5 Perforaciones y precio de paquetes
-- ---------------------------------------------------------------------
-- Crea la perforación con sus dos entradas de catálogo (solo servicio / con pieza).
CREATE OR REPLACE FUNCTION fn_crear_perforacion(
  p_admin bigint, p_codigo text, p_nombre text, p_precio_servicio numeric, p_piezas smallint DEFAULT 1
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_cat integer; v_prod_srv bigint; v_prod_paq bigint; v_var_srv bigint; v_var_paq bigint; v_id integer;
  v_codigo text := upper(trim(p_codigo));
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'PRODUCTOS_GESTIONAR');
  PERFORM fn_exigir_permiso(p_admin, 'PRECIOS_EDITAR');
  SELECT id INTO v_cat FROM categoria WHERE nombre = 'Perforaciones';
  IF v_cat IS NULL THEN RAISE EXCEPTION 'Falta la categoría "Perforaciones"'; END IF;

  INSERT INTO producto (categoria_id, nombre, tipo) VALUES (v_cat, 'Perforación ' || trim(p_nombre), 'SERVICIO')
  RETURNING id INTO v_prod_srv;
  INSERT INTO variante (producto_id, sku, nombre, precio_venta)
  VALUES (v_prod_srv, 'SRV-' || v_codigo, 'Solo servicio', p_precio_servicio)
  RETURNING id INTO v_var_srv;

  INSERT INTO producto (categoria_id, nombre, tipo) VALUES (v_cat, 'Perforación ' || trim(p_nombre) || ' con pieza', 'PAQUETE')
  RETURNING id INTO v_prod_paq;
  INSERT INTO variante (producto_id, sku, nombre, precio_venta)       -- precio calculado al vender
  VALUES (v_prod_paq, 'PAQ-' || v_codigo, 'Con pieza incluida', 0)
  RETURNING id INTO v_var_paq;

  INSERT INTO perforacion (codigo, nombre, piezas_por_paquete, servicio_variante_id, paquete_variante_id)
  VALUES (v_codigo, trim(p_nombre), p_piezas, v_var_srv, v_var_paq)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Regla 2: fija (o quita, con NULL) el precio de perforación × gama
CREATE OR REPLACE FUNCTION fn_set_precio_gama(p_admin bigint, p_perforacion integer, p_gama integer, p_precio numeric)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'PRECIOS_EDITAR');
  IF p_precio IS NULL THEN
    DELETE FROM precio_perforacion_gama WHERE perforacion_id = p_perforacion AND gama_id = p_gama;
  ELSE
    INSERT INTO precio_perforacion_gama (perforacion_id, gama_id, precio, updated_by)
    VALUES (p_perforacion, p_gama, p_precio, p_admin)
    ON CONFLICT (perforacion_id, gama_id) DO UPDATE SET precio = EXCLUDED.precio, updated_by = p_admin;
  END IF;
END $$;

-- Regla 1: fija (o quita, con NULL) un precio especial para una pieza concreta o una gama
CREATE OR REPLACE FUNCTION fn_set_precio_especial(
  p_admin bigint, p_perforacion integer, p_variante bigint, p_gama integer, p_precio numeric, p_motivo text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'PRECIOS_EDITAR');
  DELETE FROM precio_especial_paquete
   WHERE perforacion_id = p_perforacion
     AND variante_id IS NOT DISTINCT FROM p_variante AND gama_id IS NOT DISTINCT FROM p_gama;
  IF p_precio IS NOT NULL THEN
    INSERT INTO precio_especial_paquete (perforacion_id, variante_id, gama_id, precio, motivo, created_by)
    VALUES (p_perforacion, p_variante, p_gama, p_precio, p_motivo, p_admin);
  END IF;
END $$;

-- Agrega o quita una regla de pieza permitida (exactamente una de gama / categoría / variante)
CREATE OR REPLACE FUNCTION fn_set_pieza_permitida(
  p_admin bigint, p_perforacion integer, p_gama integer, p_categoria integer, p_variante bigint, p_permitir boolean
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'PRODUCTOS_GESTIONAR');
  IF p_permitir THEN
    INSERT INTO perforacion_pieza_permitida (perforacion_id, gama_id, categoria_id, variante_id)
    VALUES (p_perforacion, p_gama, p_categoria, p_variante)
    ON CONFLICT ON CONSTRAINT ux_permitida DO NOTHING;
  ELSE
    DELETE FROM perforacion_pieza_permitida
     WHERE perforacion_id = p_perforacion
       AND gama_id IS NOT DISTINCT FROM p_gama
       AND categoria_id IS NOT DISTINCT FROM p_categoria
       AND variante_id IS NOT DISTINCT FROM p_variante;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_pieza_permitida(p_perforacion integer, p_variante bigint) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM perforacion_pieza_permitida WHERE perforacion_id = p_perforacion)
      THEN EXISTS (SELECT 1 FROM variante WHERE id = p_variante AND gama_id IS NOT NULL)
    ELSE EXISTS (
      SELECT 1
        FROM perforacion_pieza_permitida r
        JOIN variante va ON va.id = p_variante
        JOIN producto pr ON pr.id = va.producto_id
       WHERE r.perforacion_id = p_perforacion
         AND va.gama_id IS NOT NULL
         AND (r.variante_id = va.id OR r.gama_id = va.gama_id OR r.categoria_id = pr.categoria_id))
  END
$$;

-- Precio de un paquete según las piezas escaneadas. Primera regla que encaje:
--   1. ESPECIAL            precio especial para esa pieza (todas iguales) o para esa gama
--   2. TABLA_GAMA          gama en modo TABLA → tabla perforación × gama (si falta, error)
--   3. SERVICIO_MAS_PIEZA  precio de solo servicio + precio de cada pieza
CREATE OR REPLACE FUNCTION fn_precio_paquete(p_perforacion integer, p_piezas bigint[])
RETURNS TABLE (precio numeric, regla text, detalle text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_perf        record;
  v_n           integer := coalesce(array_length(p_piezas, 1), 0);
  v_gamas       integer;
  v_variantes   integer;
  v_gama        record;
  v_precio      numeric;
  v_suma_piezas numeric;
  r             record;
BEGIN
  SELECT p.*, sv.precio_venta AS precio_servicio INTO v_perf
    FROM perforacion p JOIN variante sv ON sv.id = p.servicio_variante_id
   WHERE p.id = p_perforacion;
  IF v_perf.id IS NULL OR NOT v_perf.activa THEN
    RAISE EXCEPTION 'La perforación % no existe o está inactiva', p_perforacion;
  END IF;
  IF v_n <> v_perf.piezas_por_paquete THEN
    RAISE EXCEPTION 'El paquete % lleva % pieza(s); se recibieron %', v_perf.nombre, v_perf.piezas_por_paquete, v_n;
  END IF;

  FOR r IN
    SELECT u.id AS pedido, va.id, va.gama_id, va.activo AND pr.activo AS activo,
           pr.nombre || ' — ' || va.nombre AS nombre
      FROM unnest(p_piezas) AS u(id)
      LEFT JOIN variante va ON va.id = u.id
      LEFT JOIN producto pr ON pr.id = va.producto_id
  LOOP
    IF r.id IS NULL THEN RAISE EXCEPTION 'La pieza % no existe', r.pedido; END IF;
    IF r.gama_id IS NULL THEN RAISE EXCEPTION '"%" no es una pieza de perforación (no tiene gama)', r.nombre; END IF;
    IF NOT r.activo THEN RAISE EXCEPTION '"%" está inactiva', r.nombre; END IF;
    IF NOT fn_pieza_permitida(p_perforacion, r.id) THEN
      RAISE EXCEPTION '"%" no está permitida para la perforación %', r.nombre, v_perf.nombre;
    END IF;
  END LOOP;

  SELECT count(DISTINCT va.gama_id), count(DISTINCT va.id), sum(va.precio_venta)
    INTO v_gamas, v_variantes, v_suma_piezas
    FROM unnest(p_piezas) AS u(id) JOIN variante va ON va.id = u.id;

  -- Regla 1a: especial para la pieza exacta
  IF v_variantes = 1 THEN
    SELECT e.precio INTO v_precio FROM precio_especial_paquete e
     WHERE e.perforacion_id = p_perforacion AND e.variante_id = p_piezas[1];
    IF FOUND THEN
      RETURN QUERY SELECT v_precio, 'ESPECIAL'::text, 'Precio especial para esta pieza'::text;
      RETURN;
    END IF;
  END IF;

  IF v_gamas = 1 THEN
    SELECT g.* INTO v_gama FROM gama g JOIN variante va ON va.gama_id = g.id WHERE va.id = p_piezas[1];

    -- Regla 1b: especial para la gama
    SELECT e.precio INTO v_precio FROM precio_especial_paquete e
     WHERE e.perforacion_id = p_perforacion AND e.gama_id = v_gama.id;
    IF FOUND THEN
      RETURN QUERY SELECT v_precio, 'ESPECIAL'::text, format('Precio especial para gama %s', v_gama.nombre);
      RETURN;
    END IF;

    -- Regla 2: tabla perforación × gama
    IF v_gama.modo_precio = 'TABLA' THEN
      SELECT t.precio INTO v_precio FROM precio_perforacion_gama t
       WHERE t.perforacion_id = p_perforacion AND t.gama_id = v_gama.id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Falta el precio de "%" con gama "%" en la tabla de precios de perforación',
              v_perf.nombre, v_gama.nombre;
      END IF;
      RETURN QUERY SELECT v_precio, 'TABLA_GAMA'::text, format('Tabla: %s × %s', v_perf.nombre, v_gama.nombre);
      RETURN;
    END IF;
  ELSIF EXISTS (SELECT 1 FROM unnest(p_piezas) AS u(id) JOIN variante va ON va.id = u.id
                  JOIN gama g ON g.id = va.gama_id WHERE g.modo_precio = 'TABLA') THEN
    RAISE EXCEPTION 'Las piezas de un paquete con precio de tabla deben ser de la misma gama';
  END IF;

  -- Regla 3: servicio + pieza(s)
  RETURN QUERY SELECT v_perf.precio_servicio + v_suma_piezas, 'SERVICIO_MAS_PIEZA'::text,
                      format('Servicio C$ %s + pieza(s) C$ %s', v_perf.precio_servicio, v_suma_piezas);
END $$;

-- Pantalla "Precios de perforación": servicio solo, tabla por gama (NULL = falta) y excepciones
CREATE OR REPLACE VIEW v_precios_perforacion AS
SELECT p.id AS perforacion_id, p.codigo, p.nombre AS perforacion, p.piezas_por_paquete, p.activa,
       sv.precio_venta AS precio_solo_servicio,
       g.id AS gama_id, g.nombre AS gama, g.orden,
       t.precio AS precio_paquete,
       (SELECT count(*) FROM precio_especial_paquete e WHERE e.perforacion_id = p.id) AS precios_especiales
  FROM perforacion p
  JOIN variante sv ON sv.id = p.servicio_variante_id
 CROSS JOIN gama g
  LEFT JOIN precio_perforacion_gama t ON t.perforacion_id = p.id AND t.gama_id = g.id
 WHERE g.modo_precio = 'TABLA' AND g.activa;

-- Cambia el nombre de la perforación (y el de sus dos entradas del catálogo) y cuántas piezas lleva
-- su paquete. El código no cambia: de él salen los SKU SRV-xxx y PAQ-xxx.
CREATE OR REPLACE FUNCTION fn_actualizar_perforacion(p_admin bigint, p_perforacion integer, p_nombre text, p_piezas integer)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v perforacion%ROWTYPE;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'PRODUCTOS_GESTIONAR');
  SELECT * INTO v FROM perforacion WHERE id = p_perforacion FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'La perforación % no existe', p_perforacion; END IF;

  UPDATE perforacion SET nombre = trim(p_nombre), piezas_por_paquete = p_piezas WHERE id = p_perforacion;
  UPDATE producto SET nombre = 'Perforación ' || trim(p_nombre)
   WHERE id = (SELECT producto_id FROM variante WHERE id = v.servicio_variante_id);
  UPDATE producto SET nombre = 'Perforación ' || trim(p_nombre) || ' con pieza'
   WHERE id = (SELECT producto_id FROM variante WHERE id = v.paquete_variante_id);
END $$;

-- Activa o desactiva la perforación junto con sus dos entradas del catálogo (servicio y paquete):
-- desactivada no aparece en la búsqueda del POS ni se puede vender.
CREATE OR REPLACE FUNCTION fn_set_perforacion_activa(p_admin bigint, p_perforacion integer, p_activa boolean)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v perforacion%ROWTYPE;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'PRODUCTOS_GESTIONAR');
  UPDATE perforacion SET activa = p_activa WHERE id = p_perforacion RETURNING * INTO v;
  IF v.id IS NULL THEN RAISE EXCEPTION 'La perforación % no existe', p_perforacion; END IF;
  UPDATE variante SET activo = p_activa WHERE id IN (v.servicio_variante_id, v.paquete_variante_id);
  UPDATE producto SET activo = p_activa
   WHERE id IN (SELECT producto_id FROM variante WHERE id IN (v.servicio_variante_id, v.paquete_variante_id));
END $$;

-- ---------------------------------------------------------------------
-- 9.5b Catálogo: categorías, gamas, productos y variantes (pantallas del admin)
--   Los productos de tipo SERVICIO y PAQUETE son las perforaciones: solo se crean y editan con
--   las funciones de perforación. Aquí se administran las piezas y artículos con stock (PRODUCTO).
-- ---------------------------------------------------------------------
-- Crea (p_id NULL) o edita una categoría. "Perforaciones" es del sistema: fn_crear_perforacion
-- la busca por su nombre.
CREATE OR REPLACE FUNCTION fn_guardar_categoria(p_admin bigint, p_id integer, p_nombre text, p_descripcion text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v_id integer;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'PRODUCTOS_GESTIONAR');
  IF p_id IS NULL THEN
    INSERT INTO categoria (nombre, descripcion)
    VALUES (trim(p_nombre), nullif(trim(p_descripcion), ''))
    RETURNING id INTO v_id;
  ELSE
    IF (SELECT nombre FROM categoria WHERE id = p_id) = 'Perforaciones' AND trim(p_nombre) <> 'Perforaciones' THEN
      RAISE EXCEPTION 'La categoría "Perforaciones" es del sistema: no se puede renombrar';
    END IF;
    UPDATE categoria SET nombre = trim(p_nombre), descripcion = nullif(trim(p_descripcion), '')
     WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'La categoría % no existe', p_id; END IF;
  END IF;
  RETURN v_id;
END $$;

-- Una categoría inactiva no admite productos nuevos (los que ya tiene siguen igual).
CREATE OR REPLACE FUNCTION fn_set_categoria_activa(p_admin bigint, p_id integer, p_activa boolean)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_nombre text;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'PRODUCTOS_GESTIONAR');
  SELECT nombre INTO v_nombre FROM categoria WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La categoría % no existe', p_id; END IF;
  IF NOT p_activa AND v_nombre = 'Perforaciones' THEN
    RAISE EXCEPTION 'La categoría "Perforaciones" es del sistema: no se puede desactivar';
  END IF;
  UPDATE categoria SET activa = p_activa WHERE id = p_id;
END $$;

-- Crea (p_id NULL) o edita una gama. El modo de precio (TABLA / PIEZA) decide cómo se cobra el
-- paquete, por eso no se cambia cuando la gama ya tiene piezas o precios.
CREATE OR REPLACE FUNCTION fn_guardar_gama(p_admin bigint, p_id integer, p_nombre text, p_modo_precio text, p_orden integer DEFAULT 0)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  g    gama%ROWTYPE;
  v_id integer;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'PRODUCTOS_GESTIONAR');
  IF p_id IS NULL THEN
    INSERT INTO gama (nombre, modo_precio, orden)
    VALUES (trim(p_nombre), upper(trim(p_modo_precio)), coalesce(p_orden, 0))
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  SELECT * INTO g FROM gama WHERE id = p_id FOR UPDATE;
  IF g.id IS NULL THEN RAISE EXCEPTION 'La gama % no existe', p_id; END IF;
  IF g.modo_precio <> upper(trim(p_modo_precio))
     AND (EXISTS (SELECT 1 FROM variante WHERE gama_id = p_id)
       OR EXISTS (SELECT 1 FROM precio_perforacion_gama WHERE gama_id = p_id)
       OR EXISTS (SELECT 1 FROM precio_especial_paquete WHERE gama_id = p_id)) THEN
    RAISE EXCEPTION 'La gama "%" ya tiene piezas o precios: no se puede cambiar su modo de precio', g.nombre;
  END IF;
  UPDATE gama SET nombre = trim(p_nombre), modo_precio = upper(trim(p_modo_precio)), orden = coalesce(p_orden, 0)
   WHERE id = p_id;
  RETURN p_id;
END $$;

-- Una gama inactiva deja de mostrarse en la tabla de precios y no admite piezas nuevas.
CREATE OR REPLACE FUNCTION fn_set_gama_activa(p_admin bigint, p_id integer, p_activa boolean)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'PRODUCTOS_GESTIONAR');
  UPDATE gama SET activa = p_activa WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'La gama % no existe', p_id; END IF;
END $$;

-- Crea (p_id NULL) o edita un producto con stock (pieza o artículo). Sus variantes van aparte.
CREATE OR REPLACE FUNCTION fn_guardar_producto(
  p_admin bigint, p_id bigint, p_categoria integer, p_nombre text, p_descripcion text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_actual  producto%ROWTYPE;
  v_cat     categoria%ROWTYPE;
  v_id      bigint;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'PRODUCTOS_GESTIONAR');
  IF p_id IS NOT NULL THEN
    SELECT * INTO v_actual FROM producto WHERE id = p_id FOR UPDATE;
    IF v_actual.id IS NULL THEN RAISE EXCEPTION 'El producto % no existe', p_id; END IF;
    IF v_actual.tipo <> 'PRODUCTO' THEN
      RAISE EXCEPTION 'Las perforaciones (servicios y paquetes) se editan desde la pantalla de perforaciones';
    END IF;
  END IF;

  SELECT * INTO v_cat FROM categoria WHERE id = p_categoria;
  IF v_cat.id IS NULL THEN RAISE EXCEPTION 'La categoría % no existe', p_categoria; END IF;
  IF NOT v_cat.activa AND p_categoria IS DISTINCT FROM v_actual.categoria_id THEN
    RAISE EXCEPTION 'La categoría "%" está inactiva', v_cat.nombre;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO producto (categoria_id, nombre, descripcion, tipo)
    VALUES (p_categoria, trim(p_nombre), nullif(trim(p_descripcion), ''), 'PRODUCTO')
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
  UPDATE producto SET categoria_id = p_categoria, nombre = trim(p_nombre), descripcion = nullif(trim(p_descripcion), '')
   WHERE id = p_id;
  RETURN p_id;
END $$;

-- Un producto con existencias (en cualquier ubicación o en tránsito) no se desactiva: dejaría de
-- aparecer en el inventario con mercadería todavía en los estantes.
CREATE OR REPLACE FUNCTION fn_set_producto_activo(p_admin bigint, p_id bigint, p_activo boolean)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v        producto%ROWTYPE;
  v_stock  bigint;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'PRODUCTOS_GESTIONAR');
  SELECT * INTO v FROM producto WHERE id = p_id FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'El producto % no existe', p_id; END IF;
  IF v.tipo <> 'PRODUCTO' THEN
    RAISE EXCEPTION 'Las perforaciones (servicios y paquetes) se activan o desactivan desde la pantalla de perforaciones';
  END IF;
  IF NOT p_activo THEN
    SELECT coalesce(sum(fn_stock_total(va.id)), 0) INTO v_stock FROM variante va WHERE va.producto_id = p_id;
    IF v_stock > 0 THEN
      RAISE EXCEPTION 'El producto "%" todavía tiene % unidad(es) en existencia o en tránsito: no se puede desactivar',
            v.nombre, v_stock;
    END IF;
  END IF;
  UPDATE producto SET activo = p_activo WHERE id = p_id;
END $$;

-- Agrega una variante (lo que realmente se vende) a un producto con stock. Fija su precio, por eso
-- pide también PRECIOS_EDITAR. Sin nombre queda "Única".
CREATE OR REPLACE FUNCTION fn_crear_variante(
  p_admin bigint, p_producto bigint, p_sku text, p_precio_venta numeric, p_nombre text DEFAULT NULL,
  p_costo numeric DEFAULT 0, p_codigo_barras text DEFAULT NULL, p_gama integer DEFAULT NULL,
  p_atributos jsonb DEFAULT '{}'::jsonb, p_foto_url text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_tipo text;
  v_gama gama%ROWTYPE;
  v_id   bigint;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'PRODUCTOS_GESTIONAR');
  PERFORM fn_exigir_permiso(p_admin, 'PRECIOS_EDITAR');
  SELECT tipo INTO v_tipo FROM producto WHERE id = p_producto;
  IF NOT FOUND THEN RAISE EXCEPTION 'El producto % no existe', p_producto; END IF;
  IF v_tipo <> 'PRODUCTO' THEN
    RAISE EXCEPTION 'Las variantes de una perforación las crea el sistema: no se agregan a mano';
  END IF;
  IF p_gama IS NOT NULL THEN
    SELECT * INTO v_gama FROM gama WHERE id = p_gama;
    IF v_gama.id IS NULL THEN RAISE EXCEPTION 'La gama % no existe', p_gama; END IF;
    IF NOT v_gama.activa THEN RAISE EXCEPTION 'La gama "%" está inactiva', v_gama.nombre; END IF;
  END IF;

  INSERT INTO variante (producto_id, sku, codigo_barras, nombre, atributos, precio_venta, costo, gama_id, foto_url)
  VALUES (p_producto, upper(trim(p_sku)), nullif(trim(p_codigo_barras), ''),
          coalesce(nullif(trim(p_nombre), ''), 'Única'), coalesce(p_atributos, '{}'::jsonb),
          p_precio_venta, coalesce(p_costo, 0), p_gama, nullif(trim(p_foto_url), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Edita los datos de una variante, sin tocar precio ni costo (para eso, fn_set_precio_variante).
CREATE OR REPLACE FUNCTION fn_actualizar_variante(
  p_admin bigint, p_variante bigint, p_sku text, p_nombre text, p_codigo_barras text DEFAULT NULL,
  p_gama integer DEFAULT NULL, p_atributos jsonb DEFAULT '{}'::jsonb, p_foto_url text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_tipo     text;
  v_gama_act integer;
  v_gama     gama%ROWTYPE;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'PRODUCTOS_GESTIONAR');
  SELECT p.tipo, va.gama_id INTO v_tipo, v_gama_act
    FROM variante va JOIN producto p ON p.id = va.producto_id
   WHERE va.id = p_variante
     FOR UPDATE OF va;
  IF NOT FOUND THEN RAISE EXCEPTION 'La variante % no existe', p_variante; END IF;
  IF v_tipo <> 'PRODUCTO' THEN
    RAISE EXCEPTION 'Las variantes de una perforación no se editan a mano: cambie la perforación';
  END IF;
  IF p_gama IS NOT NULL AND p_gama IS DISTINCT FROM v_gama_act THEN
    SELECT * INTO v_gama FROM gama WHERE id = p_gama;
    IF v_gama.id IS NULL THEN RAISE EXCEPTION 'La gama % no existe', p_gama; END IF;
    IF NOT v_gama.activa THEN RAISE EXCEPTION 'La gama "%" está inactiva', v_gama.nombre; END IF;
  END IF;

  UPDATE variante
     SET sku = upper(trim(p_sku)), nombre = coalesce(nullif(trim(p_nombre), ''), 'Única'),
         codigo_barras = nullif(trim(p_codigo_barras), ''), gama_id = p_gama,
         atributos = coalesce(p_atributos, '{}'::jsonb), foto_url = nullif(trim(p_foto_url), '')
   WHERE id = p_variante;
END $$;

-- Precio de venta y costo de una variante (NULL = ese dato no cambia). El cambio queda en
-- historial_precio. El paquete no lleva precio propio (se calcula con la pieza) y solo las piezas
-- y artículos llevan costo.
CREATE OR REPLACE FUNCTION fn_set_precio_variante(
  p_admin bigint, p_variante bigint, p_precio_venta numeric DEFAULT NULL, p_costo numeric DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_tipo text;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'PRECIOS_EDITAR');
  SELECT p.tipo INTO v_tipo
    FROM variante va JOIN producto p ON p.id = va.producto_id
   WHERE va.id = p_variante
     FOR UPDATE OF va;
  IF NOT FOUND THEN RAISE EXCEPTION 'La variante % no existe', p_variante; END IF;
  IF v_tipo = 'PAQUETE' THEN
    RAISE EXCEPTION 'El precio de un paquete se calcula con la pieza: use la tabla de precios de perforación';
  END IF;
  IF v_tipo <> 'PRODUCTO' AND p_costo IS NOT NULL THEN
    RAISE EXCEPTION 'Solo las piezas y artículos con stock llevan costo';
  END IF;
  UPDATE variante
     SET precio_venta = coalesce(p_precio_venta, precio_venta), costo = coalesce(p_costo, costo)
   WHERE id = p_variante;
END $$;

-- Igual que el producto: una variante con existencias no se desactiva.
CREATE OR REPLACE FUNCTION fn_set_variante_activa(p_admin bigint, p_variante bigint, p_activa boolean)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_tipo    text;
  v_nombre  text;
  v_stock   bigint;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'PRODUCTOS_GESTIONAR');
  SELECT p.tipo, p.nombre || ' — ' || va.nombre INTO v_tipo, v_nombre
    FROM variante va JOIN producto p ON p.id = va.producto_id
   WHERE va.id = p_variante
     FOR UPDATE OF va;
  IF NOT FOUND THEN RAISE EXCEPTION 'La variante % no existe', p_variante; END IF;
  IF v_tipo <> 'PRODUCTO' THEN
    RAISE EXCEPTION 'Las perforaciones (servicios y paquetes) se activan o desactivan desde la pantalla de perforaciones';
  END IF;
  IF NOT p_activa THEN
    v_stock := fn_stock_total(p_variante);
    IF v_stock > 0 THEN
      RAISE EXCEPTION '"%" todavía tiene % unidad(es) en existencia o en tránsito: no se puede desactivar',
            v_nombre, v_stock;
    END IF;
  END IF;
  UPDATE variante SET activo = p_activa WHERE id = p_variante;
END $$;

-- Foto de una variante: la dirección que guarda el backend al subir la imagen (NULL la quita).
-- Devuelve la foto anterior, para que el backend borre ese archivo.
CREATE OR REPLACE FUNCTION fn_set_foto_variante(p_admin bigint, p_variante bigint, p_foto_url text)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_anterior text;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'PRODUCTOS_GESTIONAR');
  SELECT foto_url INTO v_anterior FROM variante WHERE id = p_variante FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La variante % no existe', p_variante; END IF;
  UPDATE variante SET foto_url = nullif(trim(p_foto_url), '') WHERE id = p_variante;
  RETURN v_anterior;
END $$;

-- ---------------------------------------------------------------------
-- 9.6 Compras, costo promedio y alertas
-- ---------------------------------------------------------------------
-- Unidades existentes de una variante: todas las ubicaciones + lo que va en tránsito
CREATE OR REPLACE FUNCTION fn_stock_total(p_variante bigint) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT (SELECT coalesce(sum(cantidad), 0) FROM stock_sucursal WHERE variante_id = p_variante)
       + (SELECT coalesce(sum(d.cantidad_enviada), 0)
            FROM envio_detalle d JOIN envio e ON e.id = d.envio_id
           WHERE e.estado = 'EN_TRANSITO' AND d.variante_id = p_variante)
$$;

-- Costo promedio ponderado si entran p_cantidad unidades a p_costo
CREATE OR REPLACE FUNCTION fn_costo_promedio(p_variante bigint, p_cantidad integer, p_costo numeric)
RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN st.total + p_cantidad <= 0 THEN round(p_costo, 2)
              ELSE round((st.total * va.costo + p_cantidad * p_costo) / (st.total + p_cantidad), 2) END
    FROM variante va, LATERAL (SELECT fn_stock_total(va.id) AS total) st
   WHERE va.id = p_variante
$$;

CREATE OR REPLACE FUNCTION fn_crear_proveedor(
  p_admin bigint, p_nombre text, p_pais text DEFAULT NULL, p_moneda text DEFAULT 'USD',
  p_contacto text DEFAULT NULL, p_telefono text DEFAULT NULL, p_email text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v_id integer;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'INVENTARIO_ENTRADA');
  INSERT INTO proveedor (nombre, pais, moneda_habitual, contacto, telefono, email)
  VALUES (trim(p_nombre), p_pais, upper(p_moneda), p_contacto, p_telefono, p_email)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_actualizar_proveedor(
  p_admin bigint, p_proveedor integer, p_nombre text, p_pais text DEFAULT NULL, p_moneda text DEFAULT 'USD',
  p_contacto text DEFAULT NULL, p_telefono text DEFAULT NULL, p_email text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'INVENTARIO_ENTRADA');
  UPDATE proveedor
     SET nombre = trim(p_nombre), pais = p_pais, moneda_habitual = upper(p_moneda),
         contacto = p_contacto, telefono = p_telefono, email = p_email
   WHERE id = p_proveedor;
  IF NOT FOUND THEN RAISE EXCEPTION 'El proveedor % no existe', p_proveedor; END IF;
END $$;

-- A un proveedor inactivo no se le registran compras nuevas (fn_crear_compra lo rechaza).
CREATE OR REPLACE FUNCTION fn_set_proveedor_activo(p_admin bigint, p_proveedor integer, p_activo boolean)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'INVENTARIO_ENTRADA');
  UPDATE proveedor SET activo = p_activo WHERE id = p_proveedor;
  IF NOT FOUND THEN RAISE EXCEPTION 'El proveedor % no existe', p_proveedor; END IF;
END $$;

-- Stock mínimo de una pieza en una ubicación: por debajo de él, v_stock_actual marca alerta_stock_bajo
-- y la sugerencia de reparto le da prioridad.
CREATE OR REPLACE FUNCTION fn_set_stock_minimo(p_admin bigint, p_sucursal integer, p_variante bigint, p_minimo integer)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'INVENTARIO_AJUSTAR');
  IF p_minimo IS NULL OR p_minimo < 0 THEN RAISE EXCEPTION 'El stock mínimo debe ser 0 o más'; END IF;
  IF NOT EXISTS (SELECT 1 FROM sucursal WHERE id = p_sucursal) THEN
    RAISE EXCEPTION 'La sucursal % no existe', p_sucursal;
  END IF;
  IF (SELECT pr.tipo FROM variante va JOIN producto pr ON pr.id = va.producto_id WHERE va.id = p_variante)
     IS DISTINCT FROM 'PRODUCTO' THEN
    RAISE EXCEPTION 'Solo las piezas y artículos con stock llevan stock mínimo (variante %)', p_variante;
  END IF;
  INSERT INTO stock_sucursal (sucursal_id, variante_id, cantidad, stock_minimo)
  VALUES (p_sucursal, p_variante, 0, p_minimo)
  ON CONFLICT (sucursal_id, variante_id) DO UPDATE SET stock_minimo = EXCLUDED.stock_minimo;
END $$;

-- Abre una compra en BORRADOR, siempre con destino la bodega central.
-- En dólares, si no se indica tipo de cambio se usa el vigente a la fecha de la factura.
CREATE OR REPLACE FUNCTION fn_crear_compra(
  p_admin bigint, p_proveedor integer, p_factura text, p_fecha date, p_moneda text,
  p_tipo_cambio numeric DEFAULT NULL, p_notas text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_id bigint; v_bodega integer; v_moneda text := upper(p_moneda);
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'INVENTARIO_ENTRADA');
  SELECT id INTO v_bodega FROM sucursal WHERE tipo = 'BODEGA' AND activa;
  IF v_bodega IS NULL THEN RAISE EXCEPTION 'No hay una bodega central activa'; END IF;
  IF NOT EXISTS (SELECT 1 FROM proveedor WHERE id = p_proveedor AND activo) THEN
    RAISE EXCEPTION 'El proveedor % no existe o está inactivo', p_proveedor;
  END IF;
  BEGIN
    INSERT INTO compra (proveedor_id, factura_numero, fecha_factura, moneda, tipo_cambio, sucursal_id, notas, created_by)
    VALUES (p_proveedor, trim(p_factura), p_fecha, v_moneda,
            CASE WHEN v_moneda = 'USD' THEN coalesce(p_tipo_cambio, fn_tipo_cambio_vigente(p_fecha)) ELSE 1 END,
            v_bodega, p_notas, p_admin)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'La factura % de este proveedor ya fue registrada', p_factura;
  END;
  RETURN v_id;
END $$;

-- Corrige el encabezado de una compra en borrador (proveedor, factura, fecha, moneda, tipo de cambio).
-- Las líneas y los gastos ya cargados no cambian: un gasto en dólares conserva su tipo de cambio.
CREATE OR REPLACE FUNCTION fn_actualizar_compra(
  p_admin bigint, p_compra bigint, p_proveedor integer, p_factura text, p_fecha date, p_moneda text,
  p_tipo_cambio numeric DEFAULT NULL, p_notas text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v compra%ROWTYPE; v_moneda text := upper(p_moneda);
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'INVENTARIO_ENTRADA');
  SELECT * INTO v FROM compra WHERE id = p_compra FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'La compra % no existe', p_compra; END IF;
  IF v.estado <> 'BORRADOR' THEN
    RAISE EXCEPTION 'La compra % ya está % y no se puede modificar', p_compra, lower(v.estado);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM proveedor WHERE id = p_proveedor AND (activo OR id = v.proveedor_id)) THEN
    RAISE EXCEPTION 'El proveedor % no existe o está inactivo', p_proveedor;
  END IF;
  BEGIN
    UPDATE compra
       SET proveedor_id = p_proveedor, factura_numero = trim(p_factura), fecha_factura = p_fecha, moneda = v_moneda,
           tipo_cambio = CASE WHEN v_moneda = 'USD' THEN coalesce(p_tipo_cambio, fn_tipo_cambio_vigente(p_fecha)) ELSE 1 END,
           notas = p_notas
     WHERE id = p_compra;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'La factura % de este proveedor ya fue registrada', p_factura;
  END;
END $$;

-- Agrega o actualiza una línea (cantidad recibida por defecto = facturada)
CREATE OR REPLACE FUNCTION fn_compra_set_linea(
  p_admin bigint, p_compra bigint, p_variante bigint, p_cantidad_facturada integer,
  p_costo_unitario numeric, p_cantidad_recibida integer DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'INVENTARIO_ENTRADA');
  IF (SELECT pr.tipo FROM variante va JOIN producto pr ON pr.id = va.producto_id WHERE va.id = p_variante)
     IS DISTINCT FROM 'PRODUCTO' THEN
    RAISE EXCEPTION 'Solo se compran piezas y artículos con stock (variante %)', p_variante;
  END IF;
  INSERT INTO compra_detalle (compra_id, variante_id, cantidad_facturada, cantidad_recibida, costo_unitario_factura)
  VALUES (p_compra, p_variante, p_cantidad_facturada, coalesce(p_cantidad_recibida, p_cantidad_facturada), p_costo_unitario)
  ON CONFLICT (compra_id, variante_id) DO UPDATE
    SET cantidad_facturada = EXCLUDED.cantidad_facturada,
        cantidad_recibida  = EXCLUDED.cantidad_recibida,
        costo_unitario_factura = EXCLUDED.costo_unitario_factura;
END $$;

CREATE OR REPLACE FUNCTION fn_compra_quitar_linea(p_admin bigint, p_compra bigint, p_variante bigint)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'INVENTARIO_ENTRADA');
  DELETE FROM compra_detalle WHERE compra_id = p_compra AND variante_id = p_variante;
END $$;

-- Gastos de importación. En dólares, por defecto se usa el tipo de cambio de la compra.
CREATE OR REPLACE FUNCTION fn_compra_agregar_gasto(
  p_admin bigint, p_compra bigint, p_concepto text, p_moneda text, p_monto numeric,
  p_descripcion text DEFAULT NULL, p_tipo_cambio numeric DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_id bigint; v_moneda text := upper(p_moneda);
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'INVENTARIO_ENTRADA');
  INSERT INTO compra_gasto (compra_id, concepto, descripcion, moneda, monto, tipo_cambio)
  VALUES (p_compra, upper(p_concepto), p_descripcion, v_moneda, p_monto,
          CASE WHEN v_moneda = 'USD'
               THEN coalesce(p_tipo_cambio, (SELECT tipo_cambio FROM compra WHERE id = p_compra)) ELSE 1 END)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_compra_quitar_gasto(p_admin bigint, p_gasto bigint)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'INVENTARIO_ENTRADA');
  DELETE FROM compra_gasto WHERE id = p_gasto;
END $$;

-- Vista previa del costeo (lo que el admin revisa antes de confirmar):
--   · valor en C$ de cada línea = cantidad facturada × costo × tipo de cambio
--   · gastos repartidos proporcional al valor; el redondeo se ajusta en forma acumulada,
--     así la suma de lo asignado es exactamente el total de gastos
--   · costo unitario final = (valor + gasto asignado) / cantidad facturada
--   · costo promedio nuevo con el stock actual de todas las ubicaciones
CREATE OR REPLACE FUNCTION fn_compra_calculo(p_compra bigint)
RETURNS TABLE (detalle_id bigint, variante_id bigint, producto text, cantidad_facturada integer,
               cantidad_recibida integer, valor_nio numeric, gasto_asignado_nio numeric,
               costo_unitario_final_nio numeric, costo_actual numeric, stock_actual bigint,
               costo_promedio_nuevo numeric, precio_venta numeric, margen_nuevo_pct numeric, alerta_margen boolean)
LANGUAGE sql STABLE AS $$
  WITH c AS (SELECT * FROM compra WHERE id = p_compra),
  g AS (SELECT coalesce(sum(monto_nio), 0) AS total FROM compra_gasto WHERE compra_id = p_compra),
  l AS (
    SELECT d.id, d.variante_id, d.cantidad_facturada, d.cantidad_recibida,
           round(d.cantidad_facturada * d.costo_unitario_factura * c.tipo_cambio, 2) AS valor
      FROM compra_detalle d, c WHERE d.compra_id = p_compra),
  t AS (SELECT sum(valor) AS total_valor FROM l),
  a AS (
    SELECT l.*, sum(valor) OVER (ORDER BY id) AS acum, sum(valor) OVER (ORDER BY id) - valor AS previo FROM l),
  x AS (
    SELECT a.*,
           CASE WHEN t.total_valor = 0 THEN 0
                ELSE round(g.total * a.acum / t.total_valor, 2) - round(g.total * a.previo / t.total_valor, 2) END AS gasto
      FROM a, t, g),
  y AS (
    SELECT x.*, round((x.valor + x.gasto) / x.cantidad_facturada, 4) AS cu,
           va.costo, va.precio_venta, pr.nombre || ' — ' || va.nombre AS nombre, st.total AS stock
      FROM x
      JOIN variante va ON va.id = x.variante_id
      JOIN producto pr ON pr.id = va.producto_id,
      LATERAL (SELECT fn_stock_total(x.variante_id) AS total) st),
  z AS (
    SELECT y.*,
           CASE WHEN y.cantidad_recibida = 0 THEN y.costo
                WHEN y.stock + y.cantidad_recibida <= 0 THEN round(y.cu, 2)
                ELSE round((y.stock * y.costo + y.cantidad_recibida * y.cu) / (y.stock + y.cantidad_recibida), 2) END AS nuevo
      FROM y)
  SELECT z.id, z.variante_id, z.nombre, z.cantidad_facturada, z.cantidad_recibida, z.valor, z.gasto, z.cu,
         z.costo, z.stock, z.nuevo, z.precio_venta,
         round(100 * (z.precio_venta - z.nuevo) / NULLIF(z.precio_venta, 0), 1),
         coalesce(100 * (z.precio_venta - z.nuevo) / NULLIF(z.precio_venta, 0)
                  < fn_parametro_num('MARGEN_MINIMO_ALERTA_PCT'), false)
    FROM z
   ORDER BY z.id
$$;

-- Confirma la compra: guarda el costeo, actualiza el costo promedio, suma el stock a la bodega
-- (cantidad recibida) y genera alertas de margen bajo.
CREATE OR REPLACE FUNCTION fn_confirmar_compra(p_admin bigint, p_compra bigint)
RETURNS TABLE (producto text, cantidad_recibida integer, faltantes integer, costo_unitario_final_nio numeric,
               costo_promedio_nuevo numeric, margen_nuevo_pct numeric, alerta_margen boolean)
LANGUAGE plpgsql AS $$
DECLARE v_c record; r record;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'INVENTARIO_ENTRADA');
  SELECT * INTO v_c FROM compra WHERE id = p_compra FOR UPDATE;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'La compra % no existe', p_compra; END IF;
  IF v_c.estado <> 'BORRADOR' THEN RAISE EXCEPTION 'La compra % ya está %', p_compra, lower(v_c.estado); END IF;
  IF NOT EXISTS (SELECT 1 FROM compra_detalle WHERE compra_id = p_compra) THEN
    RAISE EXCEPTION 'La compra % no tiene productos', p_compra;
  END IF;
  IF EXISTS (SELECT 1 FROM compra_gasto WHERE compra_id = p_compra)
     AND (SELECT sum(cantidad_facturada * costo_unitario_factura) FROM compra_detalle WHERE compra_id = p_compra) = 0 THEN
    RAISE EXCEPTION 'No se pueden repartir gastos en una compra sin valor';
  END IF;

  PERFORM set_config('app.confirmando_compra', 'si', true);
  FOR r IN SELECT * FROM fn_compra_calculo(p_compra) LOOP
    UPDATE compra_detalle
       SET gasto_asignado_nio = r.gasto_asignado_nio,
           costo_unitario_final_nio = r.costo_unitario_final_nio,
           costo_promedio_nuevo = r.costo_promedio_nuevo
     WHERE id = r.detalle_id;

    IF r.cantidad_recibida > 0 THEN
      UPDATE variante SET costo = r.costo_promedio_nuevo WHERE id = r.variante_id;
      INSERT INTO movimiento_inventario (sucursal_id, variante_id, tipo, cantidad, stock_resultante,
                                         costo_unitario, compra_id, motivo, usuario_id)
      VALUES (v_c.sucursal_id, r.variante_id, 'ENTRADA', r.cantidad_recibida, 0,
              round(r.costo_unitario_final_nio, 2), p_compra, 'Compra factura ' || v_c.factura_numero, p_admin);
    END IF;

    IF r.alerta_margen THEN
      INSERT INTO alerta (tipo, titulo, detalle, sucursal_id)
      VALUES ('MARGEN_BAJO',
              format('Margen bajo: %s (%s %%)', r.producto, r.margen_nuevo_pct),
              jsonb_build_object('variante_id', r.variante_id, 'compra_id', p_compra,
                                 'precio_venta', r.precio_venta, 'costo_nuevo', r.costo_promedio_nuevo,
                                 'margen_pct', r.margen_nuevo_pct,
                                 'margen_minimo_pct', fn_parametro_num('MARGEN_MINIMO_ALERTA_PCT')),
              v_c.sucursal_id);
    END IF;
  END LOOP;

  UPDATE compra SET estado = 'CONFIRMADA', confirmada_por = p_admin, fecha_confirmacion = now()
   WHERE id = p_compra;
  PERFORM set_config('app.confirmando_compra', '', true);

  RETURN QUERY
    SELECT pr.nombre || ' — ' || va.nombre, d.cantidad_recibida, d.cantidad_facturada - d.cantidad_recibida,
           d.costo_unitario_final_nio, d.costo_promedio_nuevo,
           round(100 * (va.precio_venta - d.costo_promedio_nuevo) / NULLIF(va.precio_venta, 0), 1),
           EXISTS (SELECT 1 FROM alerta a WHERE a.tipo = 'MARGEN_BAJO'
                     AND (a.detalle->>'compra_id')::bigint = p_compra
                     AND (a.detalle->>'variante_id')::bigint = d.variante_id)
      FROM compra_detalle d
      JOIN variante va ON va.id = d.variante_id
      JOIN producto pr ON pr.id = va.producto_id
     WHERE d.compra_id = p_compra
     ORDER BY d.id;
END $$;

CREATE OR REPLACE FUNCTION fn_cancelar_compra(p_admin bigint, p_compra bigint, p_motivo text)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'INVENTARIO_ENTRADA');
  UPDATE compra SET estado = 'CANCELADA',
                    notas = left(coalesce(notas || ' · ', '') || 'Cancelada: ' || p_motivo, 500)
   WHERE id = p_compra;
  IF NOT FOUND THEN RAISE EXCEPTION 'La compra % no existe', p_compra; END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_atender_alerta(p_admin bigint, p_alerta bigint)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'ALERTAS_VER');
  UPDATE alerta SET atendida_por = p_admin, atendida_at = now()
   WHERE id = p_alerta AND atendida_at IS NULL;
END $$;

-- Resumen de compras (pantalla y reporte "Compras")
CREATE OR REPLACE VIEW v_compras AS
SELECT c.id AS compra_id, c.fecha_factura, pv.nombre AS proveedor, c.factura_numero, c.moneda, c.tipo_cambio, c.estado,
       count(d.id)                                              AS lineas,
       coalesce(sum(d.cantidad_facturada), 0)                   AS piezas_facturadas,
       coalesce(sum(d.cantidad_recibida), 0)                    AS piezas_recibidas,
       coalesce(sum(d.cantidad_facturada - d.cantidad_recibida), 0) AS faltantes,
       round(coalesce(sum(d.cantidad_facturada * d.costo_unitario_factura), 0), 2) AS total_factura,
       round(coalesce(sum(d.cantidad_facturada * d.costo_unitario_factura), 0) * c.tipo_cambio, 2) AS total_factura_nio,
       (SELECT coalesce(sum(g.monto_nio), 0) FROM compra_gasto g WHERE g.compra_id = c.id) AS gastos_nio,
       round(coalesce(sum(d.cantidad_facturada * d.costo_unitario_factura), 0) * c.tipo_cambio, 2)
         + (SELECT coalesce(sum(g.monto_nio), 0) FROM compra_gasto g WHERE g.compra_id = c.id) AS costo_total_nio
  FROM compra c
  JOIN proveedor pv ON pv.id = c.proveedor_id
  LEFT JOIN compra_detalle d ON d.compra_id = c.id
 GROUP BY c.id, pv.nombre;

CREATE OR REPLACE VIEW v_compras_mensual_proveedor AS
SELECT date_trunc('month', fecha_factura)::date AS mes, proveedor, moneda,
       count(*) AS compras, sum(total_factura) AS total_factura, sum(gastos_nio) AS gastos_nio,
       sum(costo_total_nio) AS costo_total_nio,
       round(100 * sum(gastos_nio) / NULLIF(sum(total_factura_nio), 0), 1) AS gastos_sobre_factura_pct
  FROM v_compras
 WHERE estado = 'CONFIRMADA'
 GROUP BY 1, proveedor, moneda;

CREATE OR REPLACE VIEW v_alertas_pendientes AS
SELECT a.id, a.tipo, a.titulo, a.detalle, s.nombre AS ubicacion, a.creada_at
  FROM alerta a LEFT JOIN sucursal s ON s.id = a.sucursal_id
 WHERE a.atendida_at IS NULL
 ORDER BY a.creada_at DESC;

-- ---------------------------------------------------------------------
-- 9.7 Envíos, sugerencia de reparto, mermas y conteos físicos
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_crear_envio(p_admin bigint, p_origen integer, p_destino integer, p_notas text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'INVENTARIO_TRASLADAR');
  PERFORM fn_exigir_sucursal(p_admin, p_origen);
  IF (SELECT count(*) FROM sucursal WHERE id IN (p_origen, p_destino) AND activa) < 2 THEN
    RAISE EXCEPTION 'Origen o destino inexistente o inactivo';
  END IF;
  INSERT INTO envio (origen_id, destino_id, notas, creado_por)
  VALUES (p_origen, p_destino, p_notas, p_admin)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Agrega, cambia o (con cantidad 0) quita una línea del envío en borrador
CREATE OR REPLACE FUNCTION fn_envio_set_linea(p_admin bigint, p_envio bigint, p_variante bigint, p_cantidad integer)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'INVENTARIO_TRASLADAR');
  IF coalesce(p_cantidad, 0) <= 0 THEN
    DELETE FROM envio_detalle WHERE envio_id = p_envio AND variante_id = p_variante;
    RETURN;
  END IF;
  IF (SELECT pr.tipo FROM variante va JOIN producto pr ON pr.id = va.producto_id WHERE va.id = p_variante)
     IS DISTINCT FROM 'PRODUCTO' THEN
    RAISE EXCEPTION 'Solo se envían piezas y artículos con stock (variante %)', p_variante;
  END IF;
  INSERT INTO envio_detalle (envio_id, variante_id, cantidad_enviada)
  VALUES (p_envio, p_variante, p_cantidad)
  ON CONFLICT (envio_id, variante_id) DO UPDATE SET cantidad_enviada = EXCLUDED.cantidad_enviada;
END $$;

-- Paso 1: sale del origen y queda EN_TRANSITO
CREATE OR REPLACE FUNCTION fn_enviar(p_admin bigint, p_envio bigint)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_e record; r record; v_numero text;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'INVENTARIO_TRASLADAR');
  SELECT * INTO v_e FROM envio WHERE id = p_envio FOR UPDATE;
  IF v_e.id IS NULL THEN RAISE EXCEPTION 'El envío % no existe', p_envio; END IF;
  IF v_e.estado <> 'BORRADOR' THEN RAISE EXCEPTION 'El envío % ya fue enviado o cancelado', p_envio; END IF;
  PERFORM fn_exigir_sucursal(p_admin, v_e.origen_id);
  IF NOT EXISTS (SELECT 1 FROM envio_detalle WHERE envio_id = p_envio) THEN
    RAISE EXCEPTION 'El envío % no tiene productos', p_envio;
  END IF;

  v_numero := 'ENV-' || lpad(nextval('seq_envio_numero')::text, 6, '0');
  PERFORM set_config('app.procesando_envio', 'si', true);
  FOR r IN SELECT d.id, d.variante_id, d.cantidad_enviada, va.costo
             FROM envio_detalle d JOIN variante va ON va.id = d.variante_id
            WHERE d.envio_id = p_envio ORDER BY d.variante_id
  LOOP
    UPDATE envio_detalle SET costo_unitario = r.costo WHERE id = r.id;
    INSERT INTO movimiento_inventario (sucursal_id, variante_id, tipo, cantidad, stock_resultante,
                                       costo_unitario, envio_id, motivo, usuario_id)
    VALUES (v_e.origen_id, r.variante_id, 'TRASLADO_SALIDA', -r.cantidad_enviada, 0, r.costo,
            p_envio, 'Envío ' || v_numero, p_admin);
  END LOOP;
  UPDATE envio SET estado = 'EN_TRANSITO', numero = v_numero, enviado_por = p_admin, fecha_envio = now()
   WHERE id = p_envio;
  PERFORM set_config('app.procesando_envio', '', true);
  RETURN v_numero;
END $$;

-- Paso 2: la sucursal escanea lo que llegó. p_recibido: [{"variante_id": 12, "cantidad": 3}, ...]
-- (una variante puede repetirse: se suma, como al escanear pieza por pieza). Lo no escaneado = 0.
CREATE OR REPLACE FUNCTION fn_recibir_envio(p_usuario bigint, p_envio bigint, p_recibido jsonb)
RETURNS TABLE (producto text, enviada integer, recibida integer, diferencia integer)
LANGUAGE plpgsql AS $$
DECLARE v_e record; r record; v_extra text; v_dif integer;
BEGIN
  PERFORM fn_exigir_permiso(p_usuario, 'INVENTARIO_RECIBIR');
  SELECT * INTO v_e FROM envio WHERE id = p_envio FOR UPDATE;
  IF v_e.id IS NULL THEN RAISE EXCEPTION 'El envío % no existe', p_envio; END IF;
  IF v_e.estado <> 'EN_TRANSITO' THEN
    RAISE EXCEPTION 'El envío % no está en tránsito (estado: %)', coalesce(v_e.numero, p_envio::text), v_e.estado;
  END IF;
  PERFORM fn_exigir_sucursal(p_usuario, v_e.destino_id);

  IF to_regclass('pg_temp.tmp_recibido') IS NULL THEN
    CREATE TEMP TABLE tmp_recibido (variante_id bigint PRIMARY KEY, cantidad integer) ON COMMIT DROP;
  END IF;
  TRUNCATE tmp_recibido;
  INSERT INTO tmp_recibido
  SELECT (x->>'variante_id')::bigint, sum((x->>'cantidad')::integer)
    FROM jsonb_array_elements(coalesce(p_recibido, '[]'::jsonb)) x
   GROUP BY 1;

  SELECT string_agg(t.variante_id::text, ', ') INTO v_extra
    FROM tmp_recibido t
   WHERE NOT EXISTS (SELECT 1 FROM envio_detalle d WHERE d.envio_id = p_envio AND d.variante_id = t.variante_id);
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION 'Estas piezas no vienen en el envío %: %', v_e.numero, v_extra;
  END IF;
  IF EXISTS (SELECT 1 FROM tmp_recibido WHERE cantidad < 0) THEN
    RAISE EXCEPTION 'Cantidad recibida inválida';
  END IF;
  IF EXISTS (SELECT 1 FROM tmp_recibido t JOIN envio_detalle d ON d.envio_id = p_envio AND d.variante_id = t.variante_id
              WHERE t.cantidad > d.cantidad_enviada) THEN
    RAISE EXCEPTION 'Se escanearon más piezas de las enviadas; revise el conteo';
  END IF;

  PERFORM set_config('app.procesando_envio', 'si', true);
  FOR r IN SELECT d.id, d.variante_id, d.cantidad_enviada, d.costo_unitario, coalesce(t.cantidad, 0) AS rec
             FROM envio_detalle d LEFT JOIN tmp_recibido t ON t.variante_id = d.variante_id
            WHERE d.envio_id = p_envio ORDER BY d.variante_id
  LOOP
    UPDATE envio_detalle SET cantidad_recibida = r.rec WHERE id = r.id;
    IF r.rec > 0 THEN
      INSERT INTO movimiento_inventario (sucursal_id, variante_id, tipo, cantidad, stock_resultante,
                                         costo_unitario, envio_id, motivo, usuario_id)
      VALUES (v_e.destino_id, r.variante_id, 'TRASLADO_ENTRADA', r.rec, 0, r.costo_unitario,
              p_envio, 'Recepción ' || v_e.numero, p_usuario);
    END IF;
  END LOOP;

  SELECT coalesce(sum(d.cantidad_enviada - d.cantidad_recibida), 0) INTO v_dif
    FROM envio_detalle d WHERE d.envio_id = p_envio;
  UPDATE envio
     SET estado = CASE WHEN v_dif = 0 THEN 'RECIBIDO' ELSE 'RECIBIDO_CON_DIFERENCIAS' END,
         recibido_por = p_usuario, fecha_recepcion = now()
   WHERE id = p_envio;
  PERFORM set_config('app.procesando_envio', '', true);

  IF v_dif > 0 THEN
    INSERT INTO alerta (tipo, titulo, detalle, sucursal_id)
    SELECT 'ENVIO_DIFERENCIA',
           format('Envío %s: faltan %s pieza(s) al recibir', v_e.numero, v_dif),
           jsonb_build_object('envio_id', p_envio, 'numero', v_e.numero,
                              'enviado_por', v_e.enviado_por, 'recibido_por', p_usuario,
                              'faltantes', jsonb_agg(jsonb_build_object(
                                 'variante_id', d.variante_id,
                                 'enviada', d.cantidad_enviada, 'recibida', d.cantidad_recibida,
                                 'valor_costo', (d.cantidad_enviada - d.cantidad_recibida) * d.costo_unitario))),
           v_e.destino_id
      FROM envio_detalle d
     WHERE d.envio_id = p_envio AND d.cantidad_recibida < d.cantidad_enviada;
  END IF;

  RETURN QUERY
    SELECT pr.nombre || ' — ' || va.nombre, d.cantidad_enviada, d.cantidad_recibida,
           d.cantidad_recibida - d.cantidad_enviada
      FROM envio_detalle d
      JOIN variante va ON va.id = d.variante_id
      JOIN producto pr ON pr.id = va.producto_id
     WHERE d.envio_id = p_envio
     ORDER BY d.variante_id;
END $$;

CREATE OR REPLACE FUNCTION fn_cancelar_envio(p_admin bigint, p_envio bigint, p_motivo text)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'INVENTARIO_TRASLADAR');
  IF (SELECT estado FROM envio WHERE id = p_envio) <> 'BORRADOR' THEN
    RAISE EXCEPTION 'Solo se cancela un envío en borrador; uno en tránsito debe recibirse';
  END IF;
  UPDATE envio SET estado = 'CANCELADO', notas = left(coalesce(notas || ' · ', '') || 'Cancelado: ' || p_motivo, 500)
   WHERE id = p_envio;
END $$;

-- Sugerencia de reparto de p_cantidad unidades entre las sucursales de venta:
--   1) primero se cubre lo que falta para el stock mínimo (contando lo que ya va en camino)
--   2) el resto, proporcional a las unidades vendidas en los últimos 30 días (+1 para no excluir a nadie),
--      con el método D'Hondt para repartir unidades enteras
CREATE OR REPLACE FUNCTION fn_sugerir_reparto(p_variante bigint, p_cantidad integer)
RETURNS TABLE (sucursal_id integer, sucursal text, stock integer, stock_minimo integer,
               en_transito integer, vendidas_30d integer, sugerido integer)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  ids int[]; nom text[]; st int[]; mn int[]; tr int[]; ve int[]; al int[]; def0 int[];
  n int; i int; k int; best int; bestsc numeric; sc numeric;
BEGIN
  SELECT array_agg(q.id ORDER BY q.id), array_agg(q.nombre ORDER BY q.id), array_agg(q.st ORDER BY q.id),
         array_agg(q.mn ORDER BY q.id), array_agg(q.tr ORDER BY q.id), array_agg(q.ve ORDER BY q.id)
    INTO ids, nom, st, mn, tr, ve
    FROM (
      SELECT s.id, s.nombre::text,
             coalesce(ss.cantidad, 0) AS st, coalesce(ss.stock_minimo, 0) AS mn,
             (SELECT coalesce(sum(d.cantidad_enviada), 0)::int FROM envio_detalle d JOIN envio e ON e.id = d.envio_id
               WHERE e.estado = 'EN_TRANSITO' AND e.destino_id = s.id AND d.variante_id = p_variante) AS tr,
             (SELECT coalesce(sum(u.cant), 0)::int
                FROM (SELECT vd.cantidad AS cant FROM venta_detalle vd JOIN venta v ON v.id = vd.venta_id
                       WHERE v.estado = 'COMPLETADA' AND v.sucursal_id = s.id AND vd.variante_id = p_variante
                         AND v.fecha >= now() - interval '30 days'
                      UNION ALL
                      SELECT vp.cantidad FROM venta_detalle_pieza vp
                        JOIN venta_detalle vd ON vd.id = vp.venta_detalle_id JOIN venta v ON v.id = vd.venta_id
                       WHERE v.estado = 'COMPLETADA' AND v.sucursal_id = s.id AND vp.variante_id = p_variante
                         AND v.fecha >= now() - interval '30 days') u) AS ve
        FROM sucursal s
        LEFT JOIN stock_sucursal ss ON ss.sucursal_id = s.id AND ss.variante_id = p_variante
       WHERE s.tipo = 'SUCURSAL' AND s.activa) q;

  n := coalesce(array_length(ids, 1), 0);
  IF n = 0 THEN RETURN; END IF;
  al := array_fill(0, ARRAY[n]);
  def0 := array_fill(0, ARRAY[n]);
  FOR i IN 1..n LOOP
    def0[i] := greatest(mn[i] - st[i] - tr[i], 0);
  END LOOP;

  FOR k IN 1..greatest(coalesce(p_cantidad, 0), 0) LOOP
    best := 1; bestsc := -1;
    FOR i IN 1..n LOOP
      IF al[i] < def0[i] THEN
        sc := 1000000 + (def0[i] - al[i]);                    -- déficit de mínimo: prioridad absoluta
      ELSE
        sc := (ve[i] + 1)::numeric / (al[i] - def0[i] + 1);   -- D'Hondt sobre las ventas
      END IF;
      IF sc > bestsc THEN best := i; bestsc := sc; END IF;
    END LOOP;
    al[best] := al[best] + 1;
  END LOOP;

  FOR i IN 1..n LOOP
    sucursal_id := ids[i]; sucursal := nom[i]; stock := st[i]; stock_minimo := mn[i];
    en_transito := tr[i]; vendidas_30d := ve[i]; sugerido := al[i];
    RETURN NEXT;
  END LOOP;
END $$;

-- Mermas: la sucursal reporta (no descuenta) → el admin aprueba (descuenta) o rechaza
CREATE OR REPLACE FUNCTION fn_reportar_merma(
  p_usuario bigint, p_sucursal integer, p_variante bigint, p_cantidad integer, p_motivo text, p_foto_url text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_id bigint; v_stock integer; v_nombre text;
BEGIN
  PERFORM fn_exigir_permiso(p_usuario, 'INVENTARIO_REPORTAR_MERMA');
  PERFORM fn_exigir_sucursal(p_usuario, p_sucursal);
  SELECT pr.nombre || ' — ' || va.nombre INTO v_nombre
    FROM variante va JOIN producto pr ON pr.id = va.producto_id
   WHERE va.id = p_variante AND pr.tipo = 'PRODUCTO';
  IF v_nombre IS NULL THEN RAISE EXCEPTION 'Solo se reportan mermas de piezas y artículos con stock'; END IF;
  SELECT coalesce(cantidad, 0) INTO v_stock FROM stock_sucursal WHERE sucursal_id = p_sucursal AND variante_id = p_variante;
  IF coalesce(v_stock, 0) < p_cantidad THEN
    RAISE EXCEPTION 'No hay % unidad(es) de "%" en esta ubicación (hay %)', p_cantidad, v_nombre, coalesce(v_stock, 0);
  END IF;

  INSERT INTO merma (sucursal_id, variante_id, cantidad, motivo, foto_url, reportada_por)
  VALUES (p_sucursal, p_variante, p_cantidad, p_motivo, p_foto_url, p_usuario)
  RETURNING id INTO v_id;

  INSERT INTO alerta (tipo, titulo, detalle, sucursal_id)
  VALUES ('MERMA_PENDIENTE', format('Merma por aprobar: %s × %s', p_cantidad, v_nombre),
          jsonb_build_object('merma_id', v_id, 'variante_id', p_variante, 'cantidad', p_cantidad, 'motivo', p_motivo),
          p_sucursal);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_resolver_merma(p_admin bigint, p_merma bigint, p_aprobar boolean, p_comentario text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_m record; v_mov bigint;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'INVENTARIO_AJUSTAR');
  SELECT * INTO v_m FROM merma WHERE id = p_merma FOR UPDATE;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'La merma % no existe', p_merma; END IF;
  IF v_m.estado <> 'PENDIENTE' THEN RAISE EXCEPTION 'La merma % ya fue %', p_merma, lower(v_m.estado); END IF;

  IF p_aprobar THEN
    INSERT INTO movimiento_inventario (sucursal_id, variante_id, tipo, cantidad, stock_resultante,
                                       costo_unitario, motivo, usuario_id)
    VALUES (v_m.sucursal_id, v_m.variante_id, 'MERMA', -v_m.cantidad, 0,
            (SELECT costo FROM variante WHERE id = v_m.variante_id),
            left(format('Merma #%s: %s', p_merma, v_m.motivo), 200), p_admin)
    RETURNING id INTO v_mov;
  END IF;

  UPDATE merma
     SET estado = CASE WHEN p_aprobar THEN 'APROBADA' ELSE 'RECHAZADA' END,
         resuelta_por = p_admin, resuelta_at = now(), comentario = p_comentario, movimiento_id = v_mov
   WHERE id = p_merma;

  UPDATE alerta SET atendida_por = p_admin, atendida_at = now()
   WHERE tipo = 'MERMA_PENDIENTE' AND (detalle->>'merma_id')::bigint = p_merma AND atendida_at IS NULL;
END $$;

-- Conteos físicos
CREATE OR REPLACE FUNCTION fn_proteger_conteo_detalle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_estado text;
BEGIN
  SELECT estado INTO v_estado FROM conteo
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.conteo_id ELSE NEW.conteo_id END;
  IF v_estado <> 'ABIERTO' AND coalesce(current_setting('app.procesando_conteo', true), '') <> 'si' THEN
    RAISE EXCEPTION 'El conteo ya está % y no se puede modificar', lower(v_estado);
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER tg_conteo_detalle_proteger BEFORE INSERT OR UPDATE OR DELETE ON conteo_detalle
  FOR EACH ROW EXECUTE FUNCTION fn_proteger_conteo_detalle();

CREATE OR REPLACE FUNCTION fn_iniciar_conteo(
  p_usuario bigint, p_sucursal integer, p_categoria integer DEFAULT NULL, p_notas text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  PERFORM fn_exigir_permiso(p_usuario, 'INVENTARIO_CONTAR');
  PERFORM fn_exigir_sucursal(p_usuario, p_sucursal);
  BEGIN
    INSERT INTO conteo (sucursal_id, categoria_id, iniciado_por, notas)
    VALUES (p_sucursal, p_categoria, p_usuario, p_notas)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Ya hay un conteo en curso en esta ubicación';
  END;
  RETURN v_id;
END $$;

-- Registra lo escaneado. p_sumar = true suma (una pieza por escaneo); false fija la cantidad.
CREATE OR REPLACE FUNCTION fn_conteo_registrar(
  p_usuario bigint, p_conteo bigint, p_variante bigint, p_cantidad integer DEFAULT 1, p_sumar boolean DEFAULT true
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v_c record; v_total integer;
BEGIN
  PERFORM fn_exigir_permiso(p_usuario, 'INVENTARIO_CONTAR');
  SELECT * INTO v_c FROM conteo WHERE id = p_conteo;
  IF v_c.id IS NULL OR v_c.estado <> 'ABIERTO' THEN RAISE EXCEPTION 'El conteo % no está abierto', p_conteo; END IF;
  PERFORM fn_exigir_sucursal(p_usuario, v_c.sucursal_id);
  IF NOT EXISTS (SELECT 1 FROM variante va JOIN producto pr ON pr.id = va.producto_id
                  WHERE va.id = p_variante AND pr.tipo = 'PRODUCTO'
                    AND (v_c.categoria_id IS NULL OR pr.categoria_id = v_c.categoria_id)) THEN
    RAISE EXCEPTION 'La pieza % no corresponde a este conteo', p_variante;
  END IF;
  INSERT INTO conteo_detalle AS d (conteo_id, variante_id, cantidad_contada)
  VALUES (p_conteo, p_variante, p_cantidad)
  ON CONFLICT (conteo_id, variante_id) DO UPDATE
    SET cantidad_contada = CASE WHEN p_sumar THEN d.cantidad_contada + EXCLUDED.cantidad_contada
                                ELSE EXCLUDED.cantidad_contada END
  RETURNING cantidad_contada INTO v_total;
  RETURN v_total;
END $$;

-- Cierra el escaneo: toma la foto del stock del sistema. Lo que el sistema tiene y no se escaneó cuenta como 0.
CREATE OR REPLACE FUNCTION fn_enviar_conteo(p_usuario bigint, p_conteo bigint)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_c record;
BEGIN
  PERFORM fn_exigir_permiso(p_usuario, 'INVENTARIO_CONTAR');
  SELECT * INTO v_c FROM conteo WHERE id = p_conteo FOR UPDATE;
  IF v_c.id IS NULL OR v_c.estado <> 'ABIERTO' THEN RAISE EXCEPTION 'El conteo % no está abierto', p_conteo; END IF;
  PERFORM fn_exigir_sucursal(p_usuario, v_c.sucursal_id);

  PERFORM set_config('app.procesando_conteo', 'si', true);
  INSERT INTO conteo_detalle (conteo_id, variante_id, cantidad_contada)
  SELECT p_conteo, ss.variante_id, 0
    FROM stock_sucursal ss
    JOIN variante va ON va.id = ss.variante_id
    JOIN producto pr ON pr.id = va.producto_id
   WHERE ss.sucursal_id = v_c.sucursal_id AND ss.cantidad > 0
     AND (v_c.categoria_id IS NULL OR pr.categoria_id = v_c.categoria_id)
  ON CONFLICT (conteo_id, variante_id) DO NOTHING;

  UPDATE conteo_detalle d
     SET stock_sistema = coalesce((SELECT cantidad FROM stock_sucursal
                                    WHERE sucursal_id = v_c.sucursal_id AND variante_id = d.variante_id), 0)
   WHERE d.conteo_id = p_conteo;

  UPDATE conteo SET estado = 'ENVIADO', enviado_por = p_usuario, enviado_at = now() WHERE id = p_conteo;
  PERFORM set_config('app.procesando_conteo', '', true);

  INSERT INTO alerta (tipo, titulo, detalle, sucursal_id)
  SELECT 'CONTEO_POR_REVISAR',
         format('Conteo #%s por revisar: %s diferencia(s)', p_conteo, count(*) FILTER (WHERE cantidad_contada <> stock_sistema)),
         jsonb_build_object('conteo_id', p_conteo), v_c.sucursal_id
    FROM conteo_detalle WHERE conteo_id = p_conteo;
END $$;

CREATE OR REPLACE FUNCTION fn_conteo_diferencias(p_conteo bigint)
RETURNS TABLE (variante_id bigint, producto text, stock_sistema integer, contada integer,
               diferencia integer, valor_diferencia numeric)
LANGUAGE sql STABLE AS $$
  SELECT d.variante_id, pr.nombre || ' — ' || va.nombre, d.stock_sistema, d.cantidad_contada,
         d.cantidad_contada - d.stock_sistema, (d.cantidad_contada - d.stock_sistema) * va.costo
    FROM conteo_detalle d
    JOIN variante va ON va.id = d.variante_id
    JOIN producto pr ON pr.id = va.producto_id
   WHERE d.conteo_id = p_conteo AND d.stock_sistema IS NOT NULL
   ORDER BY abs(d.cantidad_contada - d.stock_sistema) DESC, 2
$$;

-- El admin aplica: cada diferencia se vuelve un ajuste en el kardex. Se aplica la diferencia de la foto,
-- así las ventas hechas después del conteo no se cuentan dos veces.
CREATE OR REPLACE FUNCTION fn_aplicar_conteo(p_admin bigint, p_conteo bigint)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v_c record; r record; n integer := 0;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'INVENTARIO_AJUSTAR');
  SELECT * INTO v_c FROM conteo WHERE id = p_conteo FOR UPDATE;
  IF v_c.id IS NULL OR v_c.estado <> 'ENVIADO' THEN RAISE EXCEPTION 'El conteo % no está listo para aplicar', p_conteo; END IF;

  FOR r IN SELECT * FROM fn_conteo_diferencias(p_conteo) WHERE diferencia <> 0 ORDER BY variante_id LOOP
    INSERT INTO movimiento_inventario (sucursal_id, variante_id, tipo, cantidad, stock_resultante,
                                       costo_unitario, motivo, usuario_id)
    VALUES (v_c.sucursal_id, r.variante_id,
            CASE WHEN r.diferencia > 0 THEN 'AJUSTE_POSITIVO' ELSE 'AJUSTE_NEGATIVO' END,
            r.diferencia, 0, (SELECT costo FROM variante WHERE id = r.variante_id),
            format('Conteo físico #%s', p_conteo), p_admin);
    n := n + 1;
  END LOOP;

  UPDATE conteo SET estado = 'APLICADO', aplicado_por = p_admin, aplicado_at = now() WHERE id = p_conteo;
  UPDATE alerta SET atendida_por = p_admin, atendida_at = now()
   WHERE tipo = 'CONTEO_POR_REVISAR' AND (detalle->>'conteo_id')::bigint = p_conteo AND atendida_at IS NULL;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION fn_cancelar_conteo(p_usuario bigint, p_conteo bigint)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_c record;
BEGIN
  PERFORM fn_exigir_permiso(p_usuario, 'INVENTARIO_CONTAR');
  SELECT * INTO v_c FROM conteo WHERE id = p_conteo FOR UPDATE;
  IF v_c.estado NOT IN ('ABIERTO','ENVIADO') THEN RAISE EXCEPTION 'El conteo % ya está cerrado', p_conteo; END IF;
  PERFORM fn_exigir_sucursal(p_usuario, v_c.sucursal_id);
  UPDATE conteo SET estado = 'CANCELADO' WHERE id = p_conteo;
END $$;

CREATE OR REPLACE VIEW v_envios AS
SELECT e.id AS envio_id, e.numero, o.nombre AS origen, d.nombre AS destino, e.estado,
       count(x.id) AS lineas,
       coalesce(sum(x.cantidad_enviada), 0) AS piezas_enviadas,
       sum(x.cantidad_recibida) AS piezas_recibidas,
       sum(x.cantidad_enviada - x.cantidad_recibida) AS faltantes,
       ue.nombre_completo AS enviado_por, e.fecha_envio,
       ur.nombre_completo AS recibido_por, e.fecha_recepcion
  FROM envio e
  JOIN sucursal o ON o.id = e.origen_id
  JOIN sucursal d ON d.id = e.destino_id
  LEFT JOIN envio_detalle x ON x.envio_id = e.id
  LEFT JOIN usuario ue ON ue.id = e.enviado_por
  LEFT JOIN usuario ur ON ur.id = e.recibido_por
 GROUP BY e.id, o.nombre, d.nombre, ue.nombre_completo, ur.nombre_completo;

-- Lo que cada sucursal tiene por recibir (pantalla de la tablet)
CREATE OR REPLACE VIEW v_envios_por_recibir AS
SELECT e.destino_id, e.id AS envio_id, e.numero, o.nombre AS origen, e.fecha_envio,
       x.variante_id, pr.nombre || ' — ' || va.nombre AS producto, va.sku, x.cantidad_enviada
  FROM envio e
  JOIN sucursal o ON o.id = e.origen_id
  JOIN envio_detalle x ON x.envio_id = e.id
  JOIN variante va ON va.id = x.variante_id
  JOIN producto pr ON pr.id = va.producto_id
 WHERE e.estado = 'EN_TRANSITO';

CREATE OR REPLACE VIEW v_mermas AS
SELECT m.id AS merma_id, s.nombre AS ubicacion, pr.nombre || ' — ' || va.nombre AS producto,
       m.cantidad, m.cantidad * va.costo AS valor_costo, m.motivo, m.estado,
       ur.nombre_completo AS reportada_por, m.reportada_at, ua.nombre_completo AS resuelta_por, m.resuelta_at, m.comentario
  FROM merma m
  JOIN sucursal s ON s.id = m.sucursal_id
  JOIN variante va ON va.id = m.variante_id
  JOIN producto pr ON pr.id = va.producto_id
  JOIN usuario ur ON ur.id = m.reportada_por
  LEFT JOIN usuario ua ON ua.id = m.resuelta_por;

-- ---------------------------------------------------------------------
-- 9.4 Panel de administración de usuarios
--     El hash de contraseña SIEMPRE se genera en el backend (argon2id/bcrypt).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_validar_asignacion_rol(p_admin bigint, p_rol_codigo text) RETURNS integer
LANGUAGE plpgsql STABLE AS $$
DECLARE v_rol integer;
BEGIN
  SELECT id INTO v_rol FROM rol WHERE codigo = upper(p_rol_codigo);
  IF v_rol IS NULL THEN RAISE EXCEPTION 'Rol inexistente: %', p_rol_codigo; END IF;
  -- Solo un ADMIN puede crear o promover administradores
  IF upper(p_rol_codigo) = 'ADMIN' AND NOT EXISTS (
       SELECT 1 FROM usuario u JOIN rol r ON r.id = u.rol_id
        WHERE u.id = p_admin AND r.codigo = 'ADMIN' AND u.activo) THEN
    RAISE EXCEPTION 'Solo un administrador puede asignar el rol ADMIN'
          USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v_rol;
END $$;

-- Solo un administrador puede modificar a otro administrador: editarlo, desactivarlo, resetear su
-- contraseña o cerrar sus sesiones. Sin esto, quien tuviera USUARIOS_GESTIONAR sin ser admin podría
-- resetear la contraseña de un administrador y entrar como él.
CREATE OR REPLACE FUNCTION fn_exigir_gestion_usuario(p_admin bigint, p_usuario bigint) RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM usuario u JOIN rol r ON r.id = u.rol_id
              WHERE u.id = p_usuario AND r.codigo = 'ADMIN')
     AND NOT EXISTS (SELECT 1 FROM usuario u JOIN rol r ON r.id = u.rol_id
                      WHERE u.id = p_admin AND r.codigo = 'ADMIN') THEN
    RAISE EXCEPTION 'Solo un administrador puede modificar a otro administrador'
          USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_crear_usuario(
  p_admin bigint, p_nombre text, p_username text, p_password_hash text,
  p_rol_codigo text, p_sucursales integer[] DEFAULT '{}',
  p_email text DEFAULT NULL, p_telefono text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_id bigint; v_rol integer;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'USUARIOS_GESTIONAR');
  v_rol := fn_validar_asignacion_rol(p_admin, p_rol_codigo);

  INSERT INTO usuario (nombre_completo, username, email, telefono, password_hash, rol_id,
                       debe_cambiar_password, created_by)
  VALUES (trim(p_nombre), lower(trim(p_username)), nullif(trim(p_email), ''), p_telefono,
          p_password_hash, v_rol, true, p_admin)
  RETURNING id INTO v_id;

  INSERT INTO usuario_sucursal (usuario_id, sucursal_id)
  SELECT v_id, unnest(p_sucursales);

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_actualizar_usuario(
  p_admin bigint, p_usuario bigint, p_nombre text, p_rol_codigo text,
  p_sucursales integer[], p_email text DEFAULT NULL, p_telefono text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_rol integer;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'USUARIOS_GESTIONAR');
  v_rol := fn_validar_asignacion_rol(p_admin, p_rol_codigo);
  PERFORM fn_exigir_gestion_usuario(p_admin, p_usuario);

  UPDATE usuario
     SET nombre_completo = trim(p_nombre), rol_id = v_rol,
         email = nullif(trim(p_email), ''), telefono = p_telefono
   WHERE id = p_usuario;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuario % no existe', p_usuario; END IF;

  -- Sincronizar sucursales (solo borra/agrega las diferencias → auditoría limpia)
  DELETE FROM usuario_sucursal
   WHERE usuario_id = p_usuario AND sucursal_id <> ALL (coalesce(p_sucursales, '{}'));
  INSERT INTO usuario_sucursal (usuario_id, sucursal_id)
  SELECT p_usuario, s FROM unnest(coalesce(p_sucursales, '{}')) s
  ON CONFLICT DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION fn_set_usuario_activo(p_admin bigint, p_usuario bigint, p_activo boolean)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'USUARIOS_GESTIONAR');
  IF p_admin = p_usuario AND NOT p_activo THEN
    RAISE EXCEPTION 'No puede desactivar su propio usuario';
  END IF;
  PERFORM fn_exigir_gestion_usuario(p_admin, p_usuario);
  UPDATE usuario SET activo = p_activo WHERE id = p_usuario;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuario % no existe', p_usuario; END IF;
END $$;

-- Reset por el admin: nueva contraseña temporal, obliga a cambiarla y desbloquea
CREATE OR REPLACE FUNCTION fn_resetear_password(p_admin bigint, p_usuario bigint, p_nuevo_hash text)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'USUARIOS_GESTIONAR');
  PERFORM fn_exigir_gestion_usuario(p_admin, p_usuario);
  UPDATE usuario
     SET password_hash = p_nuevo_hash, debe_cambiar_password = true,
         intentos_fallidos = 0, bloqueado_hasta = NULL
   WHERE id = p_usuario;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuario % no existe', p_usuario; END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_revocar_sesiones(p_admin bigint, p_usuario bigint)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'USUARIOS_GESTIONAR');
  PERFORM fn_exigir_gestion_usuario(p_admin, p_usuario);
  UPDATE sesion SET revocada_at = now() WHERE usuario_id = p_usuario AND revocada_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ---------------------------------------------------------------------
-- 9.4b Panel de administración: parámetros y permisos de los roles
-- ---------------------------------------------------------------------
-- Cambia el valor de un parámetro (NULL o vacío = sin valor, si el parámetro lo permite).
-- El formato lo valida tg_parametro_validar según su tipo (NUMERO, HORA, OPCION, TEXTO).
CREATE OR REPLACE FUNCTION fn_set_parametro(p_admin bigint, p_clave text, p_valor text)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'PARAMETROS_GESTIONAR');
  UPDATE parametro SET valor = p_valor WHERE clave = upper(trim(p_clave));
  IF NOT FOUND THEN RAISE EXCEPTION 'El parámetro % no existe', p_clave; END IF;
END $$;

-- Deja al rol exactamente con los permisos de la lista (solo quita/agrega las diferencias →
-- auditoría limpia). El rol ADMIN no se edita: fn_tiene_permiso le concede todo.
-- Nadie puede otorgar un permiso que no tiene: así un rol no puede darse más acceso a sí mismo.
CREATE OR REPLACE FUNCTION fn_set_permisos_rol(p_admin bigint, p_rol_codigo text, p_permisos text[])
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_rol      integer;
  v_codigos  text[] := ARRAY(SELECT DISTINCT upper(trim(c)) FROM unnest(coalesce(p_permisos, '{}')) c);
  v_rechazo  text;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'ROLES_GESTIONAR');
  SELECT id INTO v_rol FROM rol WHERE codigo = upper(trim(p_rol_codigo));
  IF v_rol IS NULL THEN RAISE EXCEPTION 'Rol inexistente: %', p_rol_codigo; END IF;
  IF upper(trim(p_rol_codigo)) = 'ADMIN' THEN
    RAISE EXCEPTION 'El rol ADMIN siempre tiene todos los permisos: no se puede modificar';
  END IF;

  SELECT string_agg(c, ', ' ORDER BY c) INTO v_rechazo
    FROM unnest(v_codigos) c
   WHERE NOT EXISTS (SELECT 1 FROM permiso p WHERE p.codigo = c);
  IF v_rechazo IS NOT NULL THEN RAISE EXCEPTION 'Permiso inexistente: %', v_rechazo; END IF;

  SELECT string_agg(c, ', ' ORDER BY c) INTO v_rechazo
    FROM unnest(v_codigos) c
   WHERE NOT fn_tiene_permiso(p_admin, c)
     AND NOT EXISTS (SELECT 1 FROM rol_permiso rp JOIN permiso p ON p.id = rp.permiso_id
                      WHERE rp.rol_id = v_rol AND p.codigo = c);          -- los que el rol ya tenía se respetan
  IF v_rechazo IS NOT NULL THEN
    RAISE EXCEPTION 'No puede otorgar un permiso que usted no tiene: %', v_rechazo
          USING ERRCODE = 'insufficient_privilege';
  END IF;

  DELETE FROM rol_permiso rp USING permiso p
   WHERE p.id = rp.permiso_id AND rp.rol_id = v_rol AND p.codigo <> ALL (v_codigos);
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT v_rol, p.id FROM permiso p WHERE p.codigo = ANY (v_codigos)
  ON CONFLICT DO NOTHING;
END $$;

-- Rol nuevo. Nace sin permisos: se le dan con fn_set_permisos_rol.
CREATE OR REPLACE FUNCTION fn_crear_rol(p_admin bigint, p_codigo text, p_nombre text, p_descripcion text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v_id integer;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'ROLES_GESTIONAR');
  INSERT INTO rol (codigo, nombre, descripcion, es_sistema)
  VALUES (upper(trim(p_codigo)), trim(p_nombre), nullif(trim(p_descripcion), ''), false)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_actualizar_rol(p_admin bigint, p_codigo text, p_nombre text, p_descripcion text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'ROLES_GESTIONAR');
  UPDATE rol SET nombre = trim(p_nombre), descripcion = nullif(trim(p_descripcion), '')
   WHERE codigo = upper(trim(p_codigo));
  IF NOT FOUND THEN RAISE EXCEPTION 'Rol inexistente: %', p_codigo; END IF;
END $$;

-- Solo se elimina un rol que no es de sistema y que ya no tiene usuarios (activos o no).
CREATE OR REPLACE FUNCTION fn_eliminar_rol(p_admin bigint, p_codigo text)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  r          rol%ROWTYPE;
  v_usuarios integer;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'ROLES_GESTIONAR');
  SELECT * INTO r FROM rol WHERE codigo = upper(trim(p_codigo)) FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Rol inexistente: %', p_codigo; END IF;
  IF r.es_sistema THEN RAISE EXCEPTION 'El rol % es de sistema y no se puede eliminar', r.codigo; END IF;
  SELECT count(*) INTO v_usuarios FROM usuario WHERE rol_id = r.id;
  IF v_usuarios > 0 THEN
    RAISE EXCEPTION 'El rol % tiene % usuario(s): asígneles otro rol antes de eliminarlo', r.codigo, v_usuarios;
  END IF;
  DELETE FROM rol WHERE id = r.id;
END $$;

-- Desbloquea una cuenta bloqueada por contraseñas incorrectas, sin cambiarle la contraseña.
CREATE OR REPLACE FUNCTION fn_desbloquear_usuario(p_admin bigint, p_usuario bigint)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'USUARIOS_GESTIONAR');
  PERFORM fn_exigir_gestion_usuario(p_admin, p_usuario);
  UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = p_usuario;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuario % no existe', p_usuario; END IF;
END $$;

-- ---------------------------------------------------------------------
-- 9.4c Panel de administración: sucursales y cajas
-- ---------------------------------------------------------------------
-- Crea (p_id NULL) o edita una ubicación. Las nuevas son siempre sucursales de venta: la bodega
-- central es única y viene con el sistema. El código es el prefijo de las facturas (LAM-00000001),
-- por eso no cambia cuando la sucursal ya tiene ventas.
CREATE OR REPLACE FUNCTION fn_guardar_sucursal(
  p_admin bigint, p_id integer, p_codigo text, p_nombre text, p_direccion text DEFAULT NULL, p_telefono text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v         sucursal%ROWTYPE;
  v_id      integer;
  v_codigo  text := upper(trim(p_codigo));
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'SUCURSALES_GESTIONAR');
  IF p_id IS NULL THEN
    INSERT INTO sucursal (codigo, nombre, tipo, direccion, telefono)
    VALUES (v_codigo, trim(p_nombre), 'SUCURSAL', nullif(trim(p_direccion), ''), nullif(trim(p_telefono), ''))
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  SELECT * INTO v FROM sucursal WHERE id = p_id FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'La sucursal % no existe', p_id; END IF;
  IF v.codigo <> v_codigo AND EXISTS (SELECT 1 FROM venta WHERE sucursal_id = p_id) THEN
    RAISE EXCEPTION '"%" ya tiene ventas: su código (%) es el prefijo de las facturas y no se puede cambiar',
          v.nombre, v.codigo;
  END IF;
  UPDATE sucursal
     SET codigo = v_codigo, nombre = trim(p_nombre),
         direccion = nullif(trim(p_direccion), ''), telefono = nullif(trim(p_telefono), '')
   WHERE id = p_id;
  RETURN p_id;
END $$;

-- Una ubicación inactiva sale del inventario y de los envíos, y no se abren turnos en sus cajas.
-- No se desactiva la bodega central, ni una ubicación con existencias, con un turno de caja abierto
-- o con envíos en tránsito.
CREATE OR REPLACE FUNCTION fn_set_sucursal_activa(p_admin bigint, p_id integer, p_activa boolean)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v        sucursal%ROWTYPE;
  v_stock  bigint;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'SUCURSALES_GESTIONAR');
  SELECT * INTO v FROM sucursal WHERE id = p_id FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'La sucursal % no existe', p_id; END IF;

  IF NOT p_activa THEN
    IF v.tipo = 'BODEGA' THEN
      RAISE EXCEPTION 'La bodega central no se puede desactivar: por ella entra toda la mercadería';
    END IF;
    SELECT coalesce(sum(cantidad), 0) INTO v_stock FROM stock_sucursal WHERE sucursal_id = p_id;
    IF v_stock > 0 THEN
      RAISE EXCEPTION '"%" todavía tiene % unidad(es) en existencia: envíelas a otra ubicación antes de desactivarla',
            v.nombre, v_stock;
    END IF;
    IF EXISTS (SELECT 1 FROM turno_caja t JOIN caja c ON c.id = t.caja_id
                WHERE c.sucursal_id = p_id AND t.estado = 'ABIERTO') THEN
      RAISE EXCEPTION '"%" tiene un turno de caja abierto: ciérrelo antes de desactivarla', v.nombre;
    END IF;
    IF EXISTS (SELECT 1 FROM envio WHERE estado = 'EN_TRANSITO' AND p_id IN (origen_id, destino_id)) THEN
      RAISE EXCEPTION '"%" tiene envíos en tránsito: recíbalos antes de desactivarla', v.nombre;
    END IF;
  END IF;
  UPDATE sucursal SET activa = p_activa WHERE id = p_id;
END $$;

CREATE OR REPLACE FUNCTION fn_crear_caja(p_admin bigint, p_sucursal integer, p_nombre text)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v_id integer;
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'SUCURSALES_GESTIONAR');
  IF NOT EXISTS (SELECT 1 FROM sucursal WHERE id = p_sucursal) THEN
    RAISE EXCEPTION 'La sucursal % no existe', p_sucursal;
  END IF;
  INSERT INTO caja (sucursal_id, nombre) VALUES (p_sucursal, trim(p_nombre))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_renombrar_caja(p_admin bigint, p_caja integer, p_nombre text)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'SUCURSALES_GESTIONAR');
  UPDATE caja SET nombre = trim(p_nombre) WHERE id = p_caja;
  IF NOT FOUND THEN RAISE EXCEPTION 'La caja % no existe', p_caja; END IF;
END $$;

-- En una caja inactiva no se abren turnos; no se desactiva con un turno abierto.
CREATE OR REPLACE FUNCTION fn_set_caja_activa(p_admin bigint, p_caja integer, p_activa boolean)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_exigir_permiso(p_admin, 'SUCURSALES_GESTIONAR');
  IF NOT EXISTS (SELECT 1 FROM caja WHERE id = p_caja) THEN RAISE EXCEPTION 'La caja % no existe', p_caja; END IF;
  IF NOT p_activa AND EXISTS (SELECT 1 FROM turno_caja WHERE caja_id = p_caja AND estado = 'ABIERTO') THEN
    RAISE EXCEPTION 'La caja % tiene un turno abierto: ciérrelo antes de desactivarla', p_caja;
  END IF;
  UPDATE caja SET activa = p_activa WHERE id = p_caja;
END $$;

-- =====================================================================
-- 10. VISTAS DE REPORTES Y PANEL
-- =====================================================================

-- Línea de venta con descuento global prorrateado (base de todos los reportes)
CREATE OR REPLACE VIEW v_ventas_linea AS
SELECT
  v.id                                         AS venta_id,
  d.id                                         AS detalle_id,
  v.numero,
  v.fecha,
  (v.fecha AT TIME ZONE 'America/Managua')     AS fecha_local,
  (v.fecha AT TIME ZONE 'America/Managua')::date AS dia,
  v.sucursal_id,
  s.nombre                                     AS sucursal,
  v.vendedor_id,
  u.nombre_completo                            AS vendedor,
  c.id                                         AS categoria_id,
  c.nombre                                     AS categoria,
  p.id                                         AS producto_id,
  p.nombre                                     AS producto,
  p.tipo,
  va.id                                        AS variante_id,
  va.sku,
  va.nombre                                    AS variante,
  d.cantidad,
  d.precio_lista,
  d.precio_unitario,
  d.cantidad * (d.precio_unitario - d.precio_lista) AS sobreprecio,   -- extra cobrado sobre el establecido
  d.subtotal                                   AS subtotal_linea,
  d.subtotal * CASE WHEN v.subtotal = 0 THEN 0 ELSE v.total / v.subtotal END AS venta_neta,
  d.cantidad * d.costo_unitario                AS costo,
  d.subtotal * CASE WHEN v.subtotal = 0 THEN 0 ELSE v.total / v.subtotal END
    - d.cantidad * d.costo_unitario            AS margen
FROM venta v
JOIN venta_detalle d ON d.venta_id = v.id
JOIN variante va     ON va.id = d.variante_id
JOIN producto p      ON p.id = va.producto_id
JOIN categoria c     ON c.id = p.categoria_id
JOIN sucursal s      ON s.id = v.sucursal_id
JOIN usuario u       ON u.id = v.vendedor_id
WHERE v.estado = 'COMPLETADA';

-- Resumen por periodo: 'day' | 'week' (lunes) | 'month'. p_sucursal NULL = ambas sucursales juntas.
CREATE OR REPLACE FUNCTION fn_reporte_ventas(
  p_desde date, p_hasta date, p_agrupacion text DEFAULT 'day', p_sucursal integer DEFAULT NULL
) RETURNS TABLE (periodo date, num_ventas bigint, unidades bigint, venta_neta numeric, sobreprecio numeric,
                 costo numeric, margen numeric, margen_pct numeric, ticket_promedio numeric)
LANGUAGE sql STABLE AS $$
  SELECT date_trunc(p_agrupacion, l.dia)::date,
         count(DISTINCT l.venta_id),
         sum(l.cantidad),
         round(sum(l.venta_neta), 2),
         round(sum(l.sobreprecio), 2),
         round(sum(l.costo), 2),
         round(sum(l.margen), 2),
         round(100 * sum(l.margen) / NULLIF(sum(l.venta_neta), 0), 1),
         round(sum(l.venta_neta) / NULLIF(count(DISTINCT l.venta_id), 0), 2)
    FROM v_ventas_linea l
   WHERE l.dia BETWEEN p_desde AND p_hasta
     AND (p_sucursal IS NULL OR l.sucursal_id = p_sucursal)
     AND p_agrupacion IN ('day','week','month')
   GROUP BY 1
   ORDER BY 1
$$;

-- Ranking de productos / categorías en un rango
CREATE OR REPLACE FUNCTION fn_top_productos(
  p_desde date, p_hasta date, p_sucursal integer DEFAULT NULL, p_limite int DEFAULT 10
) RETURNS TABLE (producto text, variante text, categoria text, unidades bigint,
                 venta_neta numeric, margen numeric)
LANGUAGE sql STABLE AS $$
  SELECT l.producto::text, l.variante::text, l.categoria::text, sum(l.cantidad),
         round(sum(l.venta_neta), 2), round(sum(l.margen), 2)
    FROM v_ventas_linea l
   WHERE l.dia BETWEEN p_desde AND p_hasta
     AND (p_sucursal IS NULL OR l.sucursal_id = p_sucursal)
   GROUP BY l.producto, l.variante, l.categoria
   ORDER BY 5 DESC
   LIMIT p_limite
$$;

CREATE OR REPLACE VIEW v_ventas_diarias AS
SELECT dia, sucursal_id, sucursal,
       count(DISTINCT venta_id)   AS num_ventas,
       sum(cantidad)              AS unidades,
       round(sum(venta_neta), 2)  AS venta_neta,
       round(sum(sobreprecio), 2) AS sobreprecio,
       round(sum(costo), 2)       AS costo,
       round(sum(margen), 2)      AS margen
  FROM v_ventas_linea
 GROUP BY dia, sucursal_id, sucursal;

-- Perforaciones: con pieza (paquete) contra solo servicio
CREATE OR REPLACE VIEW v_ventas_perforacion AS
SELECT l.dia, l.sucursal_id, l.sucursal, pf.id AS perforacion_id, pf.nombre AS perforacion,
       CASE WHEN l.variante_id = pf.paquete_variante_id THEN 'CON_PIEZA' ELSE 'SOLO_SERVICIO' END AS modalidad,
       sum(l.cantidad) AS cantidad, round(sum(l.venta_neta), 2) AS venta_neta, round(sum(l.margen), 2) AS margen
  FROM v_ventas_linea l
  JOIN perforacion pf ON l.variante_id IN (pf.servicio_variante_id, pf.paquete_variante_id)
 GROUP BY l.dia, l.sucursal_id, l.sucursal, pf.id, pf.nombre, 6;

-- Paquetes vendidos por gama de la pieza
CREATE OR REPLACE VIEW v_ventas_gama AS
SELECT l.dia, l.sucursal_id, l.sucursal, g.id AS gama_id, g.nombre AS gama,
       count(*) AS paquetes, round(sum(l.venta_neta), 2) AS venta_neta, round(sum(l.margen), 2) AS margen
  FROM v_ventas_linea l
  JOIN LATERAL (SELECT min(va.gama_id) AS gama_id
                  FROM venta_detalle_pieza vp JOIN variante va ON va.id = vp.variante_id
                 WHERE vp.venta_detalle_id = l.detalle_id) x ON true
  JOIN gama g ON g.id = x.gama_id
 WHERE l.tipo = 'PAQUETE'
 GROUP BY l.dia, l.sucursal_id, l.sucursal, g.id, g.nombre;

-- Piezas que salieron del inventario dentro de paquetes (para reponer)
CREATE OR REPLACE VIEW v_piezas_consumidas_paquete AS
SELECT (v.fecha AT TIME ZONE 'America/Managua')::date AS dia, v.sucursal_id, s.nombre AS sucursal,
       va.id AS variante_id, va.sku, pr.nombre || ' — ' || va.nombre AS pieza, g.nombre AS gama,
       sum(vp.cantidad) AS unidades, sum(vp.cantidad * vp.costo_unitario) AS costo
  FROM venta_detalle_pieza vp
  JOIN venta_detalle d ON d.id = vp.venta_detalle_id
  JOIN venta v ON v.id = d.venta_id AND v.estado = 'COMPLETADA'
  JOIN sucursal s ON s.id = v.sucursal_id
  JOIN variante va ON va.id = vp.variante_id
  JOIN producto pr ON pr.id = va.producto_id
  LEFT JOIN gama g ON g.id = va.gama_id
 GROUP BY 1, v.sucursal_id, s.nombre, va.id, va.sku, pr.nombre, va.nombre, g.nombre;

-- Promociones: cuánto se vendió y cuánto se descontó con cada una
CREATE OR REPLACE VIEW v_ventas_promocion AS
SELECT (v.fecha AT TIME ZONE 'America/Managua')::date AS dia, v.sucursal_id, s.nombre AS sucursal,
       p.id AS promocion_id, p.nombre AS promocion,
       count(*) AS ventas, sum(v.subtotal) AS subtotal, sum(v.descuento) AS descuento, sum(v.total) AS total
  FROM venta v
  JOIN promocion p ON p.id = v.promocion_id
  JOIN sucursal s ON s.id = v.sucursal_id
 WHERE v.estado = 'COMPLETADA'
 GROUP BY 1, v.sucursal_id, s.nombre, p.id, p.nombre;

-- Ventas cobradas por encima del precio establecido (control del administrador)
CREATE OR REPLACE VIEW v_ventas_sobreprecio AS
SELECT venta_id, numero, fecha_local, sucursal, vendedor, producto, variante, cantidad,
       precio_lista, precio_unitario,
       round(100 * (precio_unitario - precio_lista) / NULLIF(precio_lista, 0), 1) AS aumento_pct,
       sobreprecio
  FROM v_ventas_linea
 WHERE precio_unitario > precio_lista;

CREATE OR REPLACE VIEW v_ventas_semanales AS
SELECT date_trunc('week', dia)::date AS semana_inicio, sucursal_id, sucursal,
       count(DISTINCT venta_id) AS num_ventas, sum(cantidad) AS unidades,
       round(sum(venta_neta), 2) AS venta_neta, round(sum(margen), 2) AS margen
  FROM v_ventas_linea
 GROUP BY 1, sucursal_id, sucursal;

CREATE OR REPLACE VIEW v_ventas_mensuales AS
SELECT date_trunc('month', dia)::date AS mes, sucursal_id, sucursal,
       count(DISTINCT venta_id) AS num_ventas, sum(cantidad) AS unidades,
       round(sum(venta_neta), 2) AS venta_neta, round(sum(margen), 2) AS margen
  FROM v_ventas_linea
 GROUP BY 1, sucursal_id, sucursal;

CREATE OR REPLACE VIEW v_ventas_categoria_mensual AS
SELECT date_trunc('month', dia)::date AS mes, sucursal_id, sucursal, categoria_id, categoria,
       sum(cantidad) AS unidades, round(sum(venta_neta), 2) AS venta_neta, round(sum(margen), 2) AS margen
  FROM v_ventas_linea
 GROUP BY 1, sucursal_id, sucursal, categoria_id, categoria;

-- Cobros netos por método de pago (el vuelto resta del efectivo)
CREATE OR REPLACE VIEW v_cobros_metodo_diario AS
SELECT (v.fecha AT TIME ZONE 'America/Managua')::date AS dia,
       v.sucursal_id, s.nombre AS sucursal, m.nombre AS metodo, vp.moneda,
       sum(vp.monto) AS monto, sum(vp.monto_nio) AS monto_nio
  FROM venta_pago vp
  JOIN venta v       ON v.id = vp.venta_id AND v.estado = 'COMPLETADA'
  JOIN metodo_pago m ON m.id = vp.metodo_pago_id
  JOIN sucursal s    ON s.id = v.sucursal_id
 GROUP BY 1, v.sucursal_id, s.nombre, m.nombre, vp.moneda;

-- Stock actual de TODO el catálogo físico en cada sucursal (incluye los que están en 0)
CREATE OR REPLACE VIEW v_stock_actual AS
SELECT s.id AS sucursal_id, s.nombre AS sucursal, s.tipo AS tipo_ubicacion,
       c.nombre AS categoria, p.id AS producto_id, p.nombre AS producto,
       va.id AS variante_id, va.sku, va.nombre AS variante,
       coalesce(ss.cantidad, 0)     AS cantidad,
       coalesce(ss.stock_minimo, 0) AS stock_minimo,
       (SELECT coalesce(sum(d.cantidad_enviada), 0) FROM envio_detalle d JOIN envio e ON e.id = d.envio_id
         WHERE e.estado = 'EN_TRANSITO' AND e.destino_id = s.id AND d.variante_id = va.id) AS en_transito_entrante,
       coalesce(ss.cantidad, 0) <= coalesce(ss.stock_minimo, 0) AS alerta_stock_bajo,
       va.costo, va.precio_venta,
       coalesce(ss.cantidad, 0) * va.costo AS valor_costo
  FROM sucursal s
 CROSS JOIN variante va
  JOIN producto p  ON p.id = va.producto_id AND p.tipo = 'PRODUCTO'
  JOIN categoria c ON c.id = p.categoria_id
  LEFT JOIN stock_sucursal ss ON ss.sucursal_id = s.id AND ss.variante_id = va.id
 WHERE s.activa AND va.activo AND p.activo;

CREATE OR REPLACE VIEW v_inventario_valorizado AS
SELECT sucursal_id, sucursal, tipo_ubicacion, categoria,
       sum(cantidad) AS unidades,
       round(sum(valor_costo), 2) AS valor_costo,
       round(sum(cantidad * precio_venta), 2) AS valor_venta
  FROM v_stock_actual
 GROUP BY sucursal_id, sucursal, tipo_ubicacion, categoria;

-- Historial de turnos con su resultado
CREATE OR REPLACE VIEW v_turnos AS
SELECT t.id AS turno_id, s.nombre AS sucursal, c.nombre AS caja, t.estado,
       ua.nombre_completo AS abierto_por, t.fecha_apertura,
       uc.nombre_completo AS cerrado_por, t.fecha_cierre,
       (SELECT count(*) FROM venta v WHERE v.turno_id = t.id AND v.estado = 'COMPLETADA') AS ventas,
       (SELECT count(*) FROM venta v WHERE v.turno_id = t.id AND v.estado = 'ANULADA')    AS anuladas,
       (SELECT coalesce(sum(total),0) FROM venta v WHERE v.turno_id = t.id AND v.estado = 'COMPLETADA') AS total_vendido,
       (SELECT sum(d.diferencia) FILTER (WHERE d.moneda = 'NIO') FROM cierre_caja_detalle d WHERE d.turno_id = t.id) AS diferencia_nio,
       (SELECT sum(d.diferencia) FILTER (WHERE d.moneda = 'USD') FROM cierre_caja_detalle d WHERE d.turno_id = t.id) AS diferencia_usd,
       t.diferencia_apertura_nio, t.diferencia_apertura_usd,
       t.retiro_nio, t.retiro_usd, t.fondo_siguiente_nio, t.fondo_siguiente_usd,
       t.justificacion_diferencia, t.cierre_forzado
  FROM turno_caja t
  JOIN caja c      ON c.id = t.caja_id
  JOIN sucursal s  ON s.id = c.sucursal_id
  JOIN usuario ua  ON ua.id = t.usuario_apertura_id
  LEFT JOIN usuario uc ON uc.id = t.usuario_cierre_id;

-- Panel de administración: listado de usuarios
CREATE OR REPLACE VIEW v_usuarios_admin AS
SELECT u.id, u.nombre_completo, u.username, u.email, u.telefono,
       r.codigo AS rol_codigo, r.nombre AS rol,
       CASE WHEN NOT u.activo THEN 'INACTIVO'
            WHEN u.bloqueado_hasta > now() THEN 'BLOQUEADO'
            ELSE 'ACTIVO' END AS estado,
       CASE WHEN fn_tiene_permiso(u.id, 'SUCURSALES_TODAS') THEN ARRAY['Todas']::text[]
            ELSE coalesce((SELECT array_agg(s.nombre::text ORDER BY s.nombre)
                             FROM usuario_sucursal us JOIN sucursal s ON s.id = us.sucursal_id
                            WHERE us.usuario_id = u.id), ARRAY[]::text[]) END AS sucursales,
       u.debe_cambiar_password, u.intentos_fallidos, u.bloqueado_hasta, u.ultimo_acceso,
       (SELECT count(*) FROM sesion se
         WHERE se.usuario_id = u.id AND se.revocada_at IS NULL AND se.expira_at > now()) AS sesiones_activas,
       u.created_at
  FROM usuario u JOIN rol r ON r.id = u.rol_id;

-- Panel de administración: roles con sus permisos. El ADMIN los tiene todos (fn_tiene_permiso),
-- por eso no es editable.
CREATE OR REPLACE VIEW v_roles_admin AS
SELECT r.id, r.codigo, r.nombre, r.descripcion, r.es_sistema,
       r.codigo <> 'ADMIN' AS editable,
       ARRAY(SELECT p.codigo::text FROM permiso p
              WHERE r.codigo = 'ADMIN'
                 OR EXISTS (SELECT 1 FROM rol_permiso rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id)
              ORDER BY p.codigo) AS permisos,
       (SELECT count(*) FROM usuario u WHERE u.rol_id = r.id AND u.activo) AS usuarios_activos,
       (SELECT count(*) FROM usuario u WHERE u.rol_id = r.id) AS usuarios     -- con usuarios no se elimina
  FROM rol r;

-- Pantalla "Promociones": cada una con su estado de hoy (hora de Managua) y cuántas ventas la usaron.
--   VIGENTE = activa y dentro de sus fechas: es la que aparece en el POS (fn_promociones_disponibles)
CREATE OR REPLACE VIEW v_promociones_admin AS
SELECT p.id, p.nombre, p.descripcion, p.tipo, p.valor, p.compra_minima, p.vigente_desde, p.vigente_hasta, p.activa,
       CASE WHEN p.vigente_hasta < h.hoy THEN 'VENCIDA'
            WHEN NOT p.activa            THEN 'INACTIVA'
            WHEN p.vigente_desde > h.hoy THEN 'PROGRAMADA'
            ELSE 'VIGENTE' END AS estado,
       (SELECT count(*) FROM venta v WHERE v.promocion_id = p.id AND v.estado = 'COMPLETADA') AS ventas,
       p.created_at, p.updated_at
  FROM promocion p
 CROSS JOIN (SELECT (now() AT TIME ZONE 'America/Managua')::date AS hoy) h;

COMMIT;
