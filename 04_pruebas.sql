-- =====================================================================
--  ESMERALDA EXPERIENCE — Pruebas de reglas de negocio
--  Ejecutar sobre una BD con 01 + 02 + 03 cargados. Cada bloque confirma
--  (COMMIT) para probar también los triggers diferidos.
-- =====================================================================
\set ON_ERROR_STOP 1
\pset footer off

-- Helper: ejecuta SQL y exige que falle con un mensaje que contenga p_patron
CREATE OR REPLACE FUNCTION pg_temp.espera_error(p_sql text, p_patron text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'FALLO: se esperaba error "%" y no ocurrió', p_patron;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'FALLO:%' THEN RAISE; END IF;
  IF SQLERRM NOT ILIKE '%' || p_patron || '%' THEN
    RAISE EXCEPTION 'FALLO: error distinto. Esperado "%", obtenido "%"', p_patron, SQLERRM;
  END IF;
  RETURN 'OK  → ' || SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.afirma(p_cond boolean, p_msg text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT coalesce(p_cond, false) THEN RAISE EXCEPTION 'FALLO: %', p_msg; END IF;
  RETURN 'OK  → ' || p_msg;
END $$;

SELECT id AS admin   FROM usuario WHERE username = 'admin'        \gset
SELECT id AS maria   FROM usuario WHERE username = 'maria.lopez'  \gset
SELECT id AS ana     FROM usuario WHERE username = 'ana.martinez' \gset
SELECT id AS carlos  FROM usuario WHERE username = 'carlos.ruiz'  \gset
SELECT id AS lam     FROM sucursal WHERE codigo = 'LAM' \gset
SELECT id AS lbr     FROM sucursal WHERE codigo = 'LBR' \gset
SELECT id AS bod     FROM sucursal WHERE codigo = 'BOD' \gset
SELECT id AS caja_lam FROM caja WHERE sucursal_id = :lam \gset
SELECT id AS caja_lbr FROM caja WHERE sucursal_id = :lbr \gset
SELECT id AS lob  FROM variante WHERE sku = 'SRV-LOB'      \gset
SELECT id AS lab6 FROM variante WHERE sku = 'TIT-LAB-16-6' \gset
SELECT id AS lab8 FROM variante WHERE sku = 'TIT-LAB-16-8' \gset
SELECT id AS aro  FROM variante WHERE sku = 'ACE-ARO-16-8' \gset
SELECT id AS nei  FROM variante WHERE sku = 'NEI-AFT-177'  \gset
SELECT id AS cad  FROM variante WHERE sku = 'PLA-CAD-45'   \gset

\echo '\n=== 1. CAJA: apertura de turno'
SELECT fn_abrir_turno(:ana, :caja_lam, 1000, 20) AS turno \gset
SELECT pg_temp.espera_error(format('SELECT fn_abrir_turno(%s, %s)', :maria, :caja_lam), 'ya tiene un turno abierto');
SELECT pg_temp.espera_error(format('SELECT fn_abrir_turno(%s, %s)', :carlos, :caja_lam), 'no está asignado a la sucursal');

\echo '\n=== 2. VENTAS válidas'
-- V1: servicio + joya, paga C$1000 en efectivo → vuelto C$50
SELECT fn_registrar_venta(:ana, :turno,
  format('[{"variante_id":%s,"cantidad":1},{"variante_id":%s,"cantidad":1}]', :lob, :lab6)::jsonb,
  '[{"metodo":"EFECTIVO","moneda":"NIO","monto":1000}]') AS v1 \gset
SELECT pg_temp.afirma((SELECT numero = 'LAM-00000001' AND total = 950 FROM venta WHERE id = :v1), 'V1 LAM-00000001 total C$950');
SELECT pg_temp.afirma((SELECT monto = -50 AND es_vuelto FROM venta_pago WHERE venta_id = :v1 AND es_vuelto), 'V1 vuelto C$50 registrado');
SELECT pg_temp.afirma((SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :lam AND variante_id = :lab6) = 19, 'stock labret 6mm 20 → 19');
SELECT pg_temp.afirma(NOT EXISTS (SELECT 1 FROM movimiento_inventario WHERE venta_id = :v1 AND variante_id = :lob), 'el servicio no mueve inventario');

-- V2: pago mixto USD + tarjeta, exacto
SELECT fn_registrar_venta(:ana, :turno,
  format('[{"variante_id":%s,"cantidad":1},{"variante_id":%s,"cantidad":2}]', :nei, :aro)::jsonb,
  '[{"metodo":"EFECTIVO","moneda":"USD","monto":20},{"metodo":"TARJETA","moneda":"NIO","monto":287.51,"referencia":"784512"}]') AS v2 \gset
SELECT pg_temp.afirma((SELECT total = 1020 FROM venta WHERE id = :v2), 'V2 total C$1020 (pago mixto USD 20 × 36.6243 + tarjeta)');
SELECT pg_temp.afirma(NOT EXISTS (SELECT 1 FROM venta_pago WHERE venta_id = :v2 AND es_vuelto), 'V2 sin vuelto');

-- V3: paga USD 50 por cadena C$1200 → vuelto en córdobas
SELECT fn_registrar_venta(:ana, :turno, format('[{"variante_id":%s,"cantidad":1}]', :cad)::jsonb,
  '[{"metodo":"EFECTIVO","moneda":"USD","monto":50}]', 0, 'Cliente frecuente') AS v3 \gset
SELECT pg_temp.afirma((SELECT monto FROM venta_pago WHERE venta_id = :v3 AND es_vuelto) = -631.22, 'V3 vuelto C$631.22');

\echo '\n=== 3. VENTAS rechazadas'
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":1}]', '[{"metodo":"EFECTIVO","monto":1200}]', 100)$q$, :ana, :turno, :cad), 'VENTAS_DESCUENTO');
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":10}]', '[{"metodo":"EFECTIVO","monto":12000}]')$q$, :ana, :turno, :cad), 'Stock insuficiente');
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":1}]', '[{"metodo":"EFECTIVO","monto":100}]')$q$, :carlos, :turno, :aro), 'no está asignado');
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":1}]', '[{"metodo":"TARJETA","monto":250}]')$q$, :ana, :turno, :aro), 'requiere número de referencia');
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":1}]', '[{"metodo":"EFECTIVO","monto":100}]')$q$, :ana, :turno, :aro), 'Pago insuficiente');
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":1}]', '[{"metodo":"TARJETA","monto":300,"referencia":"1"}]')$q$, :ana, :turno, :aro), 'exceden el total');
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":999999,"cantidad":1}]', '[{"metodo":"EFECTIVO","monto":100}]')$q$, :ana, :turno), 'inexistente');
SELECT pg_temp.afirma((SELECT ultimo_numero_venta FROM sucursal WHERE id = :lam) = 3, 'las ventas fallidas no consumen correlativo (sin huecos)');

-- Encargada sí puede dar descuento
SELECT fn_registrar_venta(:maria, :turno, format('[{"variante_id":%s,"cantidad":1,"descuento":50}]', :aro)::jsonb,
  '[{"metodo":"TRANSFERENCIA","monto":150,"referencia":"BAC-9981"}]', 50) AS v4 \gset
SELECT pg_temp.afirma((SELECT subtotal = 200 AND total = 150 FROM venta WHERE id = :v4), 'V4 descuento línea C$50 + global C$50 (encargada)');

\echo '\n=== 4. ANULACIÓN'
SELECT pg_temp.espera_error(format('SELECT fn_anular_venta(%s, %s, %L)', :ana, :v2, 'cliente se arrepintió'), 'VENTAS_ANULAR');
SELECT fn_anular_venta(:maria, :v2, 'Cliente se arrepintió');
SELECT pg_temp.afirma((SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :lam AND variante_id = :aro) = 29, 'anulación devuelve stock de aros (30-2-1+2 = 29)');
SELECT pg_temp.espera_error(format('SELECT fn_anular_venta(%s, %s, %L)', :maria, :v2, 'otra vez'), 'ya está anulada');

\echo '\n=== 5. CIERRE DE CAJA'
SELECT fn_movimiento_caja(:maria, :turno, 'EGRESO', 'NIO', 200, 'Compra de agua y papel de ticket');
\echo 'Esperado del turno:'
SELECT metodo, moneda, monto_esperado FROM fn_resumen_turno(:turno);
-- efectivo NIO: 1000 inicial + 1000 − 50 − 631.22 − 200 egreso = 1118.78 ; USD: 20 inicial + 50 = 70 (V2 anulada)
SELECT pg_temp.afirma((SELECT monto_esperado FROM fn_resumen_turno(:turno) WHERE metodo = 'Efectivo' AND moneda = 'NIO') = 1118.78, 'efectivo NIO esperado 1118.78');
SELECT pg_temp.afirma((SELECT monto_esperado FROM fn_resumen_turno(:turno) WHERE metodo = 'Efectivo' AND moneda = 'USD') = 70, 'efectivo USD esperado 70 (excluye venta anulada)');
\echo 'Arqueo (Ana cuenta C$1100, US$70, transferencias C$150):'
SELECT * FROM fn_cerrar_turno(:ana, :turno,
  '[{"metodo":"EFECTIVO","moneda":"NIO","monto":1100},{"metodo":"EFECTIVO","moneda":"USD","monto":70},{"metodo":"TRANSFERENCIA","moneda":"NIO","monto":150}]',
  'Faltante en córdobas, revisar');
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":1}]', '[{"metodo":"EFECTIVO","monto":250}]')$q$, :ana, :turno, :aro), 'no');
SELECT pg_temp.espera_error(format('SELECT fn_anular_venta(%s, %s, %L)', :maria, :v1, 'error de digitación'), 'turno cerrado');
SELECT pg_temp.espera_error(format('SELECT fn_cerrar_turno(%s, %s, %L)', :ana, :turno, '[]'), 'ya está cerrado');

\echo '\n=== 6. INTEGRIDAD (aunque se salte las funciones)'
SELECT pg_temp.espera_error(format('UPDATE venta SET total = 1 WHERE id = %s', :v1), 'no se modifican');
SELECT pg_temp.espera_error(format('DELETE FROM venta WHERE id = %s', :v3), 'se anulan');
SELECT pg_temp.espera_error('DELETE FROM movimiento_inventario WHERE id = 1', 'solo inserción');
SELECT pg_temp.espera_error(format('UPDATE stock_sucursal SET cantidad = -1 WHERE sucursal_id = %s AND variante_id = %s', :lam, :aro), 'check');
SELECT pg_temp.espera_error(format('SELECT fn_movimiento_inventario(%s, %s, %s, %L, 1, %L)', :admin, :lam, :aro, 'MERMA', 'x'), 'ck_mov_motivo');
SELECT pg_temp.espera_error(format('SELECT fn_movimiento_inventario(%s, %s, %s, %L, 1, %L)', :ana, :lam, :aro, 'AJUSTE_NEGATIVO', 'conteo físico'), 'INVENTARIO_AJUSTAR');

-- Venta insertada "a mano" con pagos que no cuadran → falla en el COMMIT (trigger diferido)
SELECT fn_abrir_turno(:carlos, :caja_lbr, 500, 0) AS turno_lbr \gset
\set ON_ERROR_STOP 0
BEGIN;
INSERT INTO venta (numero, sucursal_id, turno_id, vendedor_id, subtotal, total, tipo_cambio)
VALUES ('LBR-MANUAL', :lbr, :turno_lbr, :carlos, 250, 250, 36.6243);
INSERT INTO venta_detalle (venta_id, variante_id, cantidad, precio_lista, precio_unitario, costo_unitario)
VALUES (currval(pg_get_serial_sequence('venta','id')), :aro, 1, 250, 250, 60);
INSERT INTO venta_pago (venta_id, metodo_pago_id, moneda, monto, tipo_cambio)
VALUES (currval(pg_get_serial_sequence('venta','id')), 1, 'NIO', 100, 1);
COMMIT;
\set ON_ERROR_STOP 1
SELECT pg_temp.afirma(NOT EXISTS (SELECT 1 FROM venta WHERE numero = 'LBR-MANUAL'), 'venta descuadrada rechazada al COMMIT');

\echo '\n=== 7. INVENTARIO: traslado y entrada'
SELECT fn_trasladar_stock(:maria, :lam, :lbr, :lab8, 4, 'Reposición Las Brisas');
SELECT pg_temp.afirma((SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :lam AND variante_id = :lab8) = 11
                  AND (SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :lbr AND variante_id = :lab8) = 4, 'traslado LAM 15→11, LBR 0→4');
SELECT pg_temp.espera_error(format('SELECT fn_trasladar_stock(%s, %s, %s, %s, 1)', :carlos, :lbr, :lam, :lab8), 'INVENTARIO_TRASLADAR');
SELECT pg_temp.espera_error(format('SELECT fn_movimiento_inventario(%s, %s, %s, %L, 10, %L, 500)', :maria, :bod, :cad, 'ENTRADA', 'Compra'), 'INVENTARIO_ENTRADA');
SELECT pg_temp.espera_error(format('SELECT fn_movimiento_inventario(%s, %s, %s, %L, 10, %L, 500)', :admin, :lam, :cad, 'ENTRADA', 'Compra'), 'solo se registran en la bodega');
SELECT set_config('app.usuario_id', :'admin', false);
SELECT fn_movimiento_inventario(:admin, :bod, :cad, 'ENTRADA', 10, 'Compra proveedor', 500);
SELECT pg_temp.afirma((SELECT precio_nuevo = 1200 AND costo_nuevo = 500 AND usuario_id = :admin FROM historial_precio WHERE variante_id = :cad ORDER BY id DESC LIMIT 1), 'entrada en bodega con costo nuevo → historial de costo con usuario');

\echo '\n=== 8. PANEL DE ADMINISTRACIÓN'
SELECT set_config('app.usuario_id', :'admin', false);
SELECT pg_temp.espera_error(format('SELECT fn_crear_usuario(%s, %L, %L, %L, %L)', :maria, 'X', 'xx.yy', 'hash', 'VENDEDOR'), 'USUARIOS_GESTIONAR');
SELECT pg_temp.espera_error(format('SELECT fn_set_usuario_activo(%s, %s, false)', :admin, :admin), 'propio usuario');
SELECT pg_temp.espera_error(format('SELECT fn_actualizar_usuario(%s, %s, %L, %L, %L)', :admin, :admin, 'Administrador', 'VENDEDOR', '{}'), 'al menos un administrador');
SELECT pg_temp.espera_error(format('SELECT fn_crear_usuario(%s, %L, %L, %L, %L)', :admin, 'Pepe', 'Pepe Grillo', 'hash', 'VENDEDOR'), 'check');

-- Promover a María a encargada de ambas sucursales
SELECT fn_actualizar_usuario(:admin, :maria, 'María López', 'ENCARGADO', ARRAY[:lam, :lbr], 'maria@example.com');
SELECT pg_temp.afirma((SELECT count(*) FROM usuario_sucursal WHERE usuario_id = :maria) = 2, 'María asignada a 2 sucursales');

-- Sesión activa de Carlos → al desactivarlo se revoca
INSERT INTO sesion (usuario_id, refresh_token_hash, expira_at)
VALUES (:carlos, encode(sha256('token-demo'), 'hex'), now() + interval '7 days');
SELECT fn_set_usuario_activo(:admin, :carlos, false);
SELECT pg_temp.afirma((SELECT revocada_at IS NOT NULL FROM sesion WHERE usuario_id = :carlos), 'desactivar usuario revoca sus sesiones');
SELECT pg_temp.afirma(NOT fn_tiene_permiso(:carlos, 'VENTAS_REGISTRAR'), 'usuario inactivo pierde todos los permisos');
SELECT fn_set_usuario_activo(:admin, :carlos, true);

-- Bloqueo por 5 intentos fallidos y desbloqueo por reset
SELECT fn_registrar_login('ana.martinez', false) FROM generate_series(1, 5);
SELECT pg_temp.afirma((SELECT estado FROM v_usuarios_admin WHERE id = :ana) = 'BLOQUEADO', '5 intentos fallidos → BLOQUEADO');
SELECT fn_resetear_password(:admin, :ana, crypt('Temporal#1', gen_salt('bf', 10)));
SELECT pg_temp.afirma((SELECT estado = 'ACTIVO' AND debe_cambiar_password FROM v_usuarios_admin WHERE id = :ana), 'reset desbloquea y obliga a cambiar contraseña');
SELECT pg_temp.afirma((SELECT count(*) FROM auditoria WHERE tabla = 'usuario' AND despues ? 'password') >= 1
                  AND NOT EXISTS (SELECT 1 FROM auditoria WHERE antes ? 'password_hash' OR despues ? 'password_hash'),
                  'auditoría registra el cambio de contraseña sin guardar el hash');

\echo '\nListado del panel de usuarios:'
SELECT username, rol, estado, sucursales, debe_cambiar_password AS cambiar_pwd, sesiones_activas FROM v_usuarios_admin ORDER BY id;

\echo '\n=== 9. REPORTES'
\echo 'Resumen diario (ambas sucursales):'
SELECT * FROM fn_reporte_ventas(current_date - 30, current_date + 1, 'day');
\echo 'Resumen mensual Las Américas:'
SELECT * FROM fn_reporte_ventas(current_date - 365, current_date + 1, 'month', :lam);
\echo 'Top productos:'
SELECT * FROM fn_top_productos(current_date - 30, current_date + 1);
\echo 'Ventas por categoría (mes):'
SELECT sucursal, categoria, unidades, venta_neta, margen FROM v_ventas_categoria_mensual ORDER BY venta_neta DESC;
\echo 'Cobros por método:'
SELECT sucursal, metodo, moneda, monto, monto_nio FROM v_cobros_metodo_diario ORDER BY 1, 2, 3;
\echo 'Alertas de stock bajo:'
SELECT sucursal, producto, variante, cantidad, stock_minimo FROM v_stock_actual WHERE alerta_stock_bajo ORDER BY 1, 2;
\echo 'Turnos:'
SELECT turno_id, sucursal, estado, abierto_por, ventas, anuladas, total_vendido, diferencia_nio, diferencia_usd FROM v_turnos;
\echo 'Búsqueda POS "labret" en LAM:'
SELECT sku, producto, variante, precio, stock FROM fn_buscar_variantes('labret', :lam);
SELECT pg_temp.afirma((SELECT sum(venta_neta) FROM fn_reporte_ventas(current_date - 30, current_date + 1, 'day')) = 950 + 1200 + 150,
                      'reporte = V1 + V3 + V4 (la anulada no cuenta) = C$2300');

\echo '\n=== 10. PRECIO DE VENTA MODIFICABLE (solo hacia arriba)'
-- Aro acero: precio establecido C$250, tope +50 % = C$375. Carlos (vendedor) en Las Brisas.
SELECT fn_registrar_venta(:carlos, :turno_lbr, format('[{"variante_id":%s,"cantidad":2,"precio":300}]', :aro)::jsonb,
  '[{"metodo":"EFECTIVO","monto":600}]') AS v5 \gset
SELECT pg_temp.afirma((SELECT precio_lista = 250 AND precio_unitario = 300 FROM venta_detalle WHERE venta_id = :v5), 'se cobra C$300 y queda registrado el establecido C$250');
SELECT pg_temp.afirma((SELECT total FROM venta WHERE id = :v5) = 600, 'total con el precio aumentado = C$600');
SELECT pg_temp.afirma((SELECT precio_venta FROM variante WHERE id = :aro) = 250, 'el precio del catálogo NO cambia');
SELECT pg_temp.afirma((SELECT sobreprecio FROM v_ventas_sobreprecio WHERE venta_id = :v5) = 100, 'reporte de sobreprecio: 2 × C$50 = C$100');

SELECT fn_registrar_venta(:carlos, :turno_lbr, format('[{"variante_id":%s,"cantidad":1}]', :aro)::jsonb,
  '[{"metodo":"EFECTIVO","monto":250}]') AS v6 \gset
SELECT pg_temp.afirma((SELECT precio_unitario FROM venta_detalle WHERE venta_id = :v6) = 250, 'sin "precio" se cobra el establecido');

SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":1,"precio":200}]', '[{"metodo":"EFECTIVO","monto":200}]')$q$, :carlos, :turno_lbr, :aro), 'no puede ser menor al establecido');
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":1,"precio":249.99}]', '[{"metodo":"EFECTIVO","monto":250}]')$q$, :carlos, :turno_lbr, :aro), 'no puede ser menor al establecido');
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":1,"precio":400}]', '[{"metodo":"EFECTIVO","monto":400}]')$q$, :carlos, :turno_lbr, :aro), 'aumento máximo');

-- Sin tope configurado
UPDATE parametro SET valor = NULL WHERE clave = 'VENTA_SOBREPRECIO_MAX_PCT';
SELECT fn_registrar_venta(:carlos, :turno_lbr, format('[{"variante_id":%s,"cantidad":1,"precio":1000}]', :aro)::jsonb,
  '[{"metodo":"EFECTIVO","monto":1000}]') AS v7 \gset
SELECT pg_temp.afirma((SELECT precio_unitario FROM venta_detalle WHERE venta_id = :v7) = 1000, 'parámetro vacío = sin límite de aumento');
UPDATE parametro SET valor = '50' WHERE clave = 'VENTA_SOBREPRECIO_MAX_PCT';

-- Si el admin le quita el permiso al rol VENDEDOR
DELETE FROM rol_permiso WHERE rol_id = (SELECT id FROM rol WHERE codigo = 'VENDEDOR')
   AND permiso_id = (SELECT id FROM permiso WHERE codigo = 'VENTAS_MODIFICAR_PRECIO');
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":1,"precio":260}]', '[{"metodo":"EFECTIVO","monto":260}]')$q$, :carlos, :turno_lbr, :aro), 'VENTAS_MODIFICAR_PRECIO');
INSERT INTO rol_permiso SELECT r.id, p.id FROM rol r, permiso p WHERE r.codigo = 'VENDEDOR' AND p.codigo = 'VENTAS_MODIFICAR_PRECIO';

-- Aunque se inserte directo (sin la función), la BD rechaza cobrar menos
SELECT pg_temp.espera_error(format('INSERT INTO venta_detalle (venta_id, variante_id, cantidad, precio_lista, precio_unitario, costo_unitario) VALUES (%s, %s, 1, 250, 100, 60)', :v6, :aro), 'ck_detalle_precio_no_menor');
SELECT pg_temp.afirma((SELECT count(*) FROM auditoria WHERE tabla = 'parametro' AND registro_id = 'VENTA_SOBREPRECIO_MAX_PCT') >= 2, 'cambios del parámetro quedan auditados');

\echo 'Ventas con sobreprecio:'
SELECT numero, vendedor, producto, cantidad, precio_lista, precio_unitario, aumento_pct, sobreprecio FROM v_ventas_sobreprecio;

\echo '\n=== 11. v1.1 PASO 1: BODEGA, EQUIPOS Y PARÁMETROS'
SELECT set_config('app.usuario_id', :'admin', false);
SELECT pg_temp.espera_error(format('INSERT INTO caja (sucursal_id, nombre) VALUES (%s, %L)', :bod, 'Caja bodega'), 'la bodega no vende');
SELECT pg_temp.espera_error($q$INSERT INTO sucursal (codigo, nombre, tipo) VALUES ('BODX', 'Otra bodega', 'BODEGA')$q$, 'ux_sucursal_una_bodega');
SELECT pg_temp.espera_error(format('UPDATE sucursal SET tipo = %L WHERE id = %s', 'BODEGA', :lam), 'no puede convertirse en bodega');
SELECT pg_temp.afirma((SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :bod AND variante_id = :lab6) = 10, 'bodega conserva lo no repartido (40 − 20 − 10 = 10)');

-- Equipos
SELECT pg_temp.espera_error(format('SELECT fn_registrar_dispositivo(%s, %L, %L, %s, %L)', :admin, 'Caja sin caja', 'CAJA', :lam, repeat('a', 64)), 'ck_dispositivo_caja');
SELECT pg_temp.espera_error(format('SELECT fn_registrar_dispositivo(%s, %L, %L, %s, %L, %s)', :admin, 'Caja cruzada', 'CAJA', :lam, repeat('b', 64), :caja_lbr), 'no pertenece a la ubicación');
SELECT pg_temp.espera_error(format('SELECT fn_registrar_dispositivo(%s, %L, %L, %s, %L)', :maria, 'Tablet', 'TABLET', :lam, repeat('c', 64)), 'SUCURSALES_GESTIONAR');
SELECT fn_registrar_dispositivo(:admin, 'Caja 1 Las Américas', 'CAJA', :lam, encode(sha256('token-caja-lam'), 'hex'), :caja_lam) AS disp_lam \gset
SELECT fn_registrar_dispositivo(:admin, 'Tablet Las Brisas', 'TABLET', :lbr, encode(sha256('token-tablet-lbr'), 'hex'));
SELECT pg_temp.afirma((SELECT sucursal_id = :lam AND caja_id = :caja_lam FROM fn_dispositivo_por_token(encode(sha256('token-caja-lam'), 'hex'))), 'el token identifica equipo, sucursal y caja');
SELECT pg_temp.afirma(NOT EXISTS (SELECT 1 FROM fn_dispositivo_por_token(encode(sha256('token-falso'), 'hex'))), 'token desconocido → sin acceso');
SELECT fn_set_dispositivo_activo(:admin, :'disp_lam', false);
SELECT pg_temp.afirma(NOT EXISTS (SELECT 1 FROM fn_dispositivo_por_token(encode(sha256('token-caja-lam'), 'hex'))), 'equipo desactivado → sin acceso');
SELECT pg_temp.afirma(NOT EXISTS (SELECT 1 FROM auditoria WHERE tabla = 'dispositivo' AND (despues ? 'token_hash' OR antes ? 'token_hash'))
                  AND EXISTS (SELECT 1 FROM auditoria WHERE tabla = 'dispositivo'), 'auditoría de equipos sin guardar el token');

-- Parámetros con validación
SELECT pg_temp.espera_error($q$UPDATE parametro SET valor = 'cuarenta' WHERE clave = 'MARGEN_MINIMO_ALERTA_PCT'$q$, 'debe ser un número');
SELECT pg_temp.espera_error($q$UPDATE parametro SET valor = NULL WHERE clave = 'MARGEN_MINIMO_ALERTA_PCT'$q$, 'no puede quedar vacío');
SELECT pg_temp.espera_error($q$UPDATE parametro SET valor = '25:00' WHERE clave = 'CAJA_HORA_ALERTA_CIERRE'$q$, 'hora HH:MM');
SELECT pg_temp.espera_error($q$UPDATE parametro SET valor = 'TODO' WHERE clave = 'BODEGA_VISIBILIDAD'$q$, 'Opciones: SI_NO, CANTIDAD');
UPDATE parametro SET valor = ' 35 ' WHERE clave = 'MARGEN_MINIMO_ALERTA_PCT';
SELECT pg_temp.afirma(fn_parametro_num('MARGEN_MINIMO_ALERTA_PCT') = 35, 'parámetro válido se guarda limpio');
UPDATE parametro SET valor = '40' WHERE clave = 'MARGEN_MINIMO_ALERTA_PCT';

-- Visibilidad del stock de bodega
SELECT pg_temp.afirma((SELECT cantidad IS NULL AND disponible FROM fn_consultar_stock(:ana, :lab6) WHERE tipo = 'BODEGA'), 'vendedora ve bodega solo como disponible sí/no');
SELECT pg_temp.afirma((SELECT cantidad FROM fn_consultar_stock(:ana, :lab6) WHERE sucursal_id = :lbr) = 10, 'vendedora ve la cantidad de la otra sucursal');
SELECT pg_temp.afirma((SELECT cantidad FROM fn_consultar_stock(:admin, :lab6) WHERE tipo = 'BODEGA') = 10, 'admin ve la cantidad exacta en bodega');
UPDATE parametro SET valor = 'CANTIDAD' WHERE clave = 'BODEGA_VISIBILIDAD';
SELECT pg_temp.afirma((SELECT cantidad FROM fn_consultar_stock(:ana, :lab6) WHERE tipo = 'BODEGA') = 10, 'con BODEGA_VISIBILIDAD = CANTIDAD la vendedora ve el número');
UPDATE parametro SET valor = 'SI_NO' WHERE clave = 'BODEGA_VISIBILIDAD';
\echo 'Consulta de stock de la vendedora (labret 6 mm):'
SELECT sucursal, tipo, cantidad, disponible FROM fn_consultar_stock(:ana, :lab6);

\echo '\n*** TODAS LAS PRUEBAS PASARON ***'
