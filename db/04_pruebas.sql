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

-- Helper: ejecuta SQL y devuelve el código (SQLSTATE) con que falló, o NULL si no falló
CREATE OR REPLACE FUNCTION pg_temp.codigo_error(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
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
  '[{"metodo":"EFECTIVO","moneda":"USD","monto":50}]', NULL, 'Cliente frecuente') AS v3 \gset
SELECT pg_temp.afirma((SELECT monto FROM venta_pago WHERE venta_id = :v3 AND es_vuelto) = -631.22, 'V3 vuelto C$631.22');

\echo '\n=== 3. VENTAS rechazadas'
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":1}]', '[{"metodo":"EFECTIVO","monto":1200}]', 999999)$q$, :ana, :turno, :cad), 'promoción 999999 no existe');
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":0}]', '[{"metodo":"EFECTIVO","monto":1200}]')$q$, :ana, :turno, :cad), 'Cantidad inválida');
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":10}]', '[{"metodo":"EFECTIVO","monto":12000}]')$q$, :ana, :turno, :cad), 'Stock insuficiente');
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":1}]', '[{"metodo":"EFECTIVO","monto":100}]')$q$, :carlos, :turno, :aro), 'no está asignado');
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":1}]', '[{"metodo":"TARJETA","monto":250}]')$q$, :ana, :turno, :aro), 'requiere número de referencia');
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":1}]', '[{"metodo":"EFECTIVO","monto":100}]')$q$, :ana, :turno, :aro), 'Pago insuficiente');
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":1}]', '[{"metodo":"TARJETA","monto":300,"referencia":"1"}]')$q$, :ana, :turno, :aro), 'exceden el total');
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":999999,"cantidad":1}]', '[{"metodo":"EFECTIVO","monto":100}]')$q$, :ana, :turno), 'inexistente');
SELECT pg_temp.afirma((SELECT ultimo_numero_venta FROM sucursal WHERE id = :lam) = 3, 'las ventas fallidas no consumen correlativo (sin huecos)');

-- Promoción creada y activada por el admin; la encargada la aplica
SELECT fn_guardar_promocion(:admin, NULL, 'Prueba 40 %', 'PORCENTAJE', 40) AS promo40 \gset
SELECT fn_set_promocion_activa(:admin, :promo40, true);
SELECT fn_registrar_venta(:maria, :turno, format('[{"variante_id":%s,"cantidad":1}]', :aro)::jsonb,
  '[{"metodo":"TRANSFERENCIA","monto":150,"referencia":"BAC-9981"}]', :promo40) AS v4 \gset
SELECT pg_temp.afirma((SELECT subtotal = 250 AND descuento = 100 AND total = 150 AND promocion_id = :promo40 FROM venta WHERE id = :v4), 'V4 con promoción 40 %: 250 − 100 = C$150');

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
\echo 'Arqueo ciego (Ana cuenta C$1100 y US$70 billete por billete, transferencias C$150; retira C$1000 y US$50):'
SELECT fn_cerrar_turno(:ana, :turno,
  '[{"moneda":"NIO","valor":1000,"cantidad":1},{"moneda":"NIO","valor":100,"cantidad":1},{"moneda":"USD","valor":50,"cantidad":1},{"moneda":"USD","valor":20,"cantidad":1}]',
  '[{"metodo":"TRANSFERENCIA","monto":150}]', 1000, 50, NULL, 'Cierre normal') AS ticket1 \gset
SELECT pg_temp.afirma((SELECT monto_contado = 1100 AND diferencia = -18.78 FROM cierre_caja_detalle d JOIN metodo_pago m ON m.id = d.metodo_pago_id
                        WHERE d.turno_id = :turno AND m.es_efectivo AND d.moneda = 'NIO'), 'faltante de C$18.78 (dentro de la tolerancia de 100: no pide justificación)');
SELECT pg_temp.afirma((:'ticket1'::jsonb->>'fondo_siguiente_nio')::numeric = 100 AND (:'ticket1'::jsonb->>'fondo_siguiente_usd')::numeric = 20, 'fondo para mañana: C$100 y US$20');
SELECT pg_temp.afirma(NOT (:'ticket1'::jsonb ? 'diferencia') AND NOT (:'ticket1'::jsonb::text ILIKE '%esperado%'), 'el ticket de cierre no muestra esperado ni diferencias');
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

\echo '\n=== 7. INVENTARIO: envío entre sucursales y entrada'
SELECT fn_crear_envio(:admin, :lam, :lbr, 'Reposición Las Brisas') AS env7 \gset
SELECT fn_envio_set_linea(:admin, :env7, :lab8, 4);
SELECT fn_enviar(:admin, :env7);
SELECT * FROM fn_recibir_envio(:carlos, :env7, format('[{"variante_id":%s,"cantidad":4}]', :lab8)::jsonb);
SELECT pg_temp.afirma((SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :lam AND variante_id = :lab8) = 11
                  AND (SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :lbr AND variante_id = :lab8) = 4, 'envío LAM 15→11, LBR 0→4 (enviado y recibido)');
SELECT pg_temp.espera_error(format('SELECT fn_crear_envio(%s, %s, %s)', :maria, :lbr, :lam), 'INVENTARIO_TRASLADAR');
SELECT pg_temp.espera_error(format('SELECT fn_movimiento_inventario(%s, %s, %s, %L, 10, %L, 500)', :maria, :bod, :cad, 'ENTRADA', 'Compra'), 'INVENTARIO_ENTRADA');
SELECT pg_temp.espera_error(format('SELECT fn_movimiento_inventario(%s, %s, %s, %L, 10, %L, 500)', :admin, :lam, :cad, 'ENTRADA', 'Compra'), 'solo se registran en la bodega');
SELECT set_config('app.usuario_id', :'admin', false);
SELECT sum(cantidad) AS cad_stock FROM stock_sucursal WHERE variante_id = :cad \gset
SELECT fn_movimiento_inventario(:admin, :bod, :cad, 'ENTRADA', 10, 'Compra proveedor', 500);
SELECT pg_temp.afirma((SELECT costo_nuevo = round((:cad_stock * 480 + 10 * 500)::numeric / (:cad_stock + 10), 2) AND usuario_id = :admin
                         FROM historial_precio WHERE variante_id = :cad ORDER BY id DESC LIMIT 1),
                      'entrada en bodega: costo promedio ponderado ' || :cad_stock || ' × 480 + 10 × 500, con historial y usuario');

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

\echo '\n=== 12. v1.1 PASO 2: PERFORACIONES, GAMAS Y PRECIO DE PAQUETES'
SELECT id AS pdr  FROM variante WHERE sku = 'ACE-LAB-PDR' \gset
SELECT id AS p_lob  FROM perforacion WHERE codigo = 'LOB'  \gset
SELECT id AS p_hlx  FROM perforacion WHERE codigo = 'HLX'  \gset
SELECT id AS p_par  FROM perforacion WHERE codigo = 'LOBP' \gset
SELECT id AS p_trg  FROM perforacion WHERE codigo = 'TRG'  \gset
SELECT id AS g_cla  FROM gama WHERE nombre = 'Acero clásica' \gset
SELECT id AS g_tit  FROM gama WHERE nombre = 'Titanio' \gset

-- Regla 2 (tabla por gama) y regla 3 (servicio + pieza)
SELECT pg_temp.afirma((SELECT precio = 450 AND regla = 'TABLA_GAMA' FROM fn_precio_paquete(:p_hlx, ARRAY[:aro]::bigint[])), 'hélix + acero clásica = C$450 (tabla)');
SELECT pg_temp.afirma((SELECT precio = 550 AND regla = 'TABLA_GAMA' FROM fn_precio_paquete(:p_hlx, ARRAY[:pdr]::bigint[])), 'hélix + acero de lujo = C$550 (tabla)');
SELECT pg_temp.afirma((SELECT precio = 1000 AND regla = 'SERVICIO_MAS_PIEZA' FROM fn_precio_paquete(:p_hlx, ARRAY[:lab6]::bigint[])), 'hélix + titanio 6 mm = 350 + 650 = C$1000 (servicio + pieza)');
-- Regla 1 (especial) gana a las demás
SELECT pg_temp.afirma((SELECT precio = 900 AND regla = 'ESPECIAL' FROM fn_precio_paquete(:p_hlx, ARRAY[:lab8]::bigint[])), 'hélix + titanio 8 mm = C$900 (precio especial)');
SELECT fn_set_precio_especial(:admin, :p_hlx, NULL, :g_cla, 400, 'Temporada');
SELECT pg_temp.afirma((SELECT precio = 400 AND regla = 'ESPECIAL' FROM fn_precio_paquete(:p_hlx, ARRAY[:aro]::bigint[])), 'especial por gama gana a la tabla');
SELECT fn_set_precio_especial(:admin, :p_hlx, NULL, :g_cla, NULL);
SELECT pg_temp.afirma((SELECT precio = 450 FROM fn_precio_paquete(:p_hlx, ARRAY[:aro]::bigint[])), 'al quitar el especial vuelve la tabla');
-- Paquete de 2 piezas
SELECT pg_temp.afirma((SELECT precio = 600 FROM fn_precio_paquete(:p_par, ARRAY[:aro, :aro]::bigint[])), 'lóbulos par + 2 clásicas = C$600 (tabla)');
SELECT pg_temp.afirma((SELECT precio = 500 + 650 + 650 FROM fn_precio_paquete(:p_par, ARRAY[:lab6, :lab8]::bigint[])), 'lóbulos par + 2 titanio = servicio + ambas piezas');
SELECT pg_temp.espera_error(format('SELECT * FROM fn_precio_paquete(%s, ARRAY[%s, %s]::bigint[])', :p_par, :aro, :lab6), 'misma gama');
SELECT pg_temp.espera_error(format('SELECT * FROM fn_precio_paquete(%s, ARRAY[%s]::bigint[])', :p_par, :aro), 'lleva 2 pieza(s); se recibieron 1');
-- Validaciones de pieza
SELECT pg_temp.espera_error(format('SELECT * FROM fn_precio_paquete(%s, ARRAY[%s]::bigint[])', :p_lob, :pdr), 'no está permitida');
SELECT pg_temp.afirma((SELECT precio = 350 FROM fn_precio_paquete(:p_lob, ARRAY[:aro]::bigint[])), 'lóbulo acepta acero clásica (permitida)');
SELECT pg_temp.espera_error(format('SELECT * FROM fn_precio_paquete(%s, ARRAY[%s]::bigint[])', :p_hlx, :nei), 'no es una pieza de perforación');
SELECT pg_temp.espera_error(format('SELECT * FROM fn_precio_paquete(%s, ARRAY[%s]::bigint[])', :p_trg, :aro), 'Falta el precio');
SELECT pg_temp.afirma((SELECT precio = 400 + 650 FROM fn_precio_paquete(:p_trg, ARRAY[:lab6]::bigint[])), 'tragus sin tabla igual vende titanio (servicio + pieza)');
-- Reglas del catálogo
SELECT pg_temp.espera_error(format('UPDATE variante SET gama_id = %s WHERE id = %s', :g_cla, :lob), 'Solo las piezas');
SELECT pg_temp.espera_error(format('SELECT fn_set_precio_gama(%s, %s, %s, 999)', :admin, :p_hlx, :g_tit), 'precio por pieza');
SELECT pg_temp.espera_error(format('SELECT fn_set_precio_gama(%s, %s, %s, 999)', :ana, :p_hlx, :g_cla), 'PRECIOS_EDITAR');
SELECT pg_temp.espera_error(format('SELECT fn_movimiento_inventario(%s, %s, (SELECT paquete_variante_id FROM perforacion WHERE id = %s), %L, 1)', :admin, :bod, :p_hlx, 'ENTRADA'), 'no manejan inventario');
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, format('[{"variante_id":%%s,"cantidad":1}]', (SELECT paquete_variante_id FROM perforacion WHERE id = %s))::jsonb, '[{"metodo":"EFECTIVO","monto":500}]')$q$, :carlos, :turno_lbr, :p_hlx), 'requiere escanear');
SELECT pg_temp.espera_error(format('SELECT fn_crear_perforacion(%s, %L, %L, 300)', :admin, 'HLX', 'Hélix 2'), 'duplicate key');
-- Solo servicio: el precio vive en la variante de servicio (historial de precios incluido)
UPDATE variante SET precio_venta = 380 WHERE id = (SELECT servicio_variante_id FROM perforacion WHERE id = :p_hlx);
SELECT pg_temp.afirma((SELECT precio = 380 + 650 FROM fn_precio_paquete(:p_hlx, ARRAY[:lab6]::bigint[])), 'cambiar el precio de solo servicio actualiza la regla 3');
SELECT pg_temp.afirma(EXISTS (SELECT 1 FROM historial_precio WHERE precio_anterior = 350 AND precio_nuevo = 380), 'cambio del precio de servicio queda en el historial');
UPDATE variante SET precio_venta = 350 WHERE id = (SELECT servicio_variante_id FROM perforacion WHERE id = :p_hlx);

\echo 'Pantalla de precios de perforación (NULL = falta precio):'
SELECT perforacion, precio_solo_servicio AS servicio, gama, precio_paquete, precios_especiales FROM v_precios_perforacion ORDER BY perforacion_id, orden;
\echo 'Búsqueda POS "hélix" en LAM:'
SELECT sku, producto, variante, tipo, precio, stock FROM fn_buscar_variantes('hélix', :lam);

\echo '\n=== 13. v1.1 PASO 3: COMPRAS, GASTOS DE IMPORTACIÓN Y COSTO PROMEDIO'
SELECT set_config('app.usuario_id', :'admin', false);
SELECT id AS prov_usa FROM proveedor WHERE nombre = 'Body Jewelry Supply' \gset
SELECT id AS prov_loc FROM proveedor WHERE nombre = 'Distribuidora Local' \gset
SELECT pg_temp.espera_error(format('SELECT fn_crear_compra(%s, %s, %L, current_date, %L)', :maria, :prov_usa, 'X-1', 'USD'), 'INVENTARIO_ENTRADA');

-- Factura en dólares a TC 36.60: 3 líneas + courier US$20 + aduana C$364
SELECT fn_crear_compra(:admin, :prov_usa, 'INV-1001', current_date, 'USD', 36.60) AS compra1 \gset
SELECT fn_compra_set_linea(:admin, :compra1, :lab6, 10, 6.00);            -- valor 10 × 6 × 36.60 = 2196.00
SELECT fn_compra_set_linea(:admin, :compra1, :aro, 20, 1.00, 18);          -- valor 732.00; llegaron 18 de 20
SELECT fn_compra_set_linea(:admin, :compra1, :nei, 5, 10.00);              -- valor 1830.00
SELECT fn_compra_agregar_gasto(:admin, :compra1, 'COURIER', 'USD', 20);    -- 732.00
SELECT fn_compra_agregar_gasto(:admin, :compra1, 'ADUANA', 'NIO', 364);    -- 364.00  → gastos 1096.00
SELECT pg_temp.espera_error(format('SELECT fn_compra_set_linea(%s, %s, %s, 1, 1)', :admin, :compra1, :lob), 'Solo se compran piezas');
SELECT pg_temp.espera_error(format('SELECT fn_compra_set_linea(%s, %s, %s, 5, 1, 6)', :admin, :compra1, :lab8), 'ck_compra_recibida');

\echo 'Vista previa del costeo:'
SELECT producto, cantidad_facturada AS fact, cantidad_recibida AS rec, valor_nio, gasto_asignado_nio AS gasto,
       costo_unitario_final_nio AS costo_final, costo_actual, costo_promedio_nuevo AS promedio, margen_nuevo_pct AS margen, alerta_margen
  FROM fn_compra_calculo(:compra1);
SELECT pg_temp.afirma((SELECT sum(gasto_asignado_nio) FROM fn_compra_calculo(:compra1)) = 1096.00, 'los gastos repartidos suman exactamente C$1096.00');
SELECT pg_temp.afirma((SELECT abs(gasto_asignado_nio - 1096 * 2196 / 4758.0) < 0.01 FROM fn_compra_calculo(:compra1) WHERE variante_id = :lab6), 'reparto proporcional al valor (labret: 2196 / 4758 del gasto)');
SELECT pg_temp.afirma((SELECT costo_unitario_final_nio = round((valor_nio + gasto_asignado_nio) / 10, 4) FROM fn_compra_calculo(:compra1) WHERE variante_id = :lab6), 'costo final = (valor + gasto) / cantidad facturada');
SELECT pg_temp.afirma((SELECT alerta_margen FROM fn_compra_calculo(:compra1) WHERE variante_id = :nei), 'la vista previa avisa margen bajo en NeilMed');
SELECT pg_temp.afirma((SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :bod AND variante_id = :lab6) = 10, 'en borrador el stock no cambia');

-- Datos antes de confirmar para verificar el promedio
SELECT sum(cantidad) AS lab6_stock FROM stock_sucursal WHERE variante_id = :lab6 \gset
SELECT costo AS lab6_costo FROM variante WHERE id = :lab6 \gset
SELECT costo_unitario_final_nio AS lab6_cf FROM fn_compra_calculo(:compra1) WHERE variante_id = :lab6 \gset

\echo 'Confirmación:'
SELECT * FROM fn_confirmar_compra(:admin, :compra1);
SELECT pg_temp.afirma((SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :bod AND variante_id = :lab6) = 20
                  AND (SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :bod AND variante_id = :aro) = 10 + 18, 'stock entra a bodega por la cantidad RECIBIDA (aros: 18 de 20)');
SELECT pg_temp.afirma((SELECT costo FROM variante WHERE id = :lab6) = round((:lab6_stock * :lab6_costo + 10 * :lab6_cf) / (:lab6_stock + 10), 2), 'costo promedio ponderado del labret actualizado');
SELECT pg_temp.afirma((SELECT count(*) FROM movimiento_inventario WHERE compra_id = :compra1 AND tipo = 'ENTRADA') = 3, 'kardex: 3 entradas enlazadas a la compra');
SELECT pg_temp.afirma(EXISTS (SELECT 1 FROM v_alertas_pendientes WHERE tipo = 'MARGEN_BAJO' AND (detalle->>'variante_id')::bigint = :nei), 'alerta de margen bajo creada para NeilMed');
SELECT pg_temp.afirma((SELECT faltantes = 2 AND gastos_nio = 1096 AND estado = 'CONFIRMADA' FROM v_compras WHERE compra_id = :compra1), 'resumen de compra: 2 faltantes, gastos 1096, confirmada');

-- Una compra confirmada no se toca
SELECT pg_temp.espera_error(format('SELECT fn_compra_set_linea(%s, %s, %s, 1, 1)', :admin, :compra1, :lab6), 'ya está confirmada');
SELECT pg_temp.espera_error(format('SELECT fn_compra_agregar_gasto(%s, %s, %L, %L, 10)', :admin, :compra1, 'OTRO', 'NIO'), 'ya está confirmada');
SELECT pg_temp.espera_error(format('SELECT * FROM fn_confirmar_compra(%s, %s)', :admin, :compra1), 'ya está confirmada');
SELECT pg_temp.espera_error(format('SELECT fn_cancelar_compra(%s, %s, %L)', :admin, :compra1, 'error'), 'ya está confirmada');
SELECT pg_temp.espera_error(format('UPDATE compra_detalle SET cantidad_recibida = 1 WHERE compra_id = %s', :compra1), 'ya está confirmada');
SELECT pg_temp.espera_error(format('SELECT fn_crear_compra(%s, %s, %L, current_date, %L)', :admin, :prov_usa, 'INV-1001', 'USD'), 'ya fue registrada');

-- Compra en córdobas sin gastos, y dólares con tipo de cambio vigente
SELECT fn_crear_compra(:admin, :prov_loc, 'F-0001', current_date, 'NIO') AS compra2 \gset
SELECT pg_temp.espera_error(format('SELECT * FROM fn_confirmar_compra(%s, %s)', :admin, :compra2), 'no tiene productos');
SELECT fn_compra_set_linea(:admin, :compra2, :pdr, 10, 95);
SELECT * FROM fn_confirmar_compra(:admin, :compra2);
SELECT pg_temp.afirma((SELECT gasto_asignado_nio = 0 AND costo_unitario_final_nio = 95 FROM compra_detalle WHERE compra_id = :compra2), 'compra en córdobas sin gastos: costo final = costo de factura');
SELECT fn_crear_compra(:admin, :prov_usa, 'INV-1002', current_date, 'USD') AS compra3 \gset
SELECT pg_temp.afirma((SELECT tipo_cambio = fn_tipo_cambio_vigente() FROM compra WHERE id = :compra3), 'sin tipo de cambio se usa el vigente');
SELECT fn_cancelar_compra(:admin, :compra3, 'Pedido duplicado');
SELECT pg_temp.espera_error(format('SELECT * FROM fn_confirmar_compra(%s, %s)', :admin, :compra3), 'ya está cancelada');

-- Alertas
SELECT id AS alerta_nei FROM alerta WHERE tipo = 'MARGEN_BAJO' AND (detalle->>'variante_id')::bigint = :nei \gset
SELECT pg_temp.espera_error(format('SELECT fn_atender_alerta(%s, %s)', :maria, :alerta_nei), 'ALERTAS_VER');
SELECT fn_atender_alerta(:admin, :alerta_nei);
SELECT pg_temp.afirma(NOT EXISTS (SELECT 1 FROM v_alertas_pendientes WHERE id = :alerta_nei), 'alerta atendida sale de pendientes');

\echo 'Compras del mes por proveedor:'
SELECT proveedor, moneda, compras, total_factura, gastos_nio, costo_total_nio, gastos_sobre_factura_pct FROM v_compras_mensual_proveedor;

\echo '\n=== 14. v1.1 PASO 4: ENVÍOS EN DOS PASOS, SUGERENCIA DE REPARTO, MERMAS Y CONTEOS'
SELECT set_config('app.usuario_id', :'admin', false);
-- Envío bodega → Las Brisas
SELECT cantidad AS bod_lab6 FROM stock_sucursal WHERE sucursal_id = :bod AND variante_id = :lab6 \gset
SELECT cantidad AS lbr_lab6 FROM stock_sucursal WHERE sucursal_id = :lbr AND variante_id = :lab6 \gset
SELECT cantidad AS lbr_aro  FROM stock_sucursal WHERE sucursal_id = :lbr AND variante_id = :aro \gset
SELECT fn_stock_total(:lab6) AS total_lab6 \gset
SELECT fn_crear_envio(:admin, :bod, :lbr) AS env1 \gset
SELECT pg_temp.espera_error(format('SELECT fn_enviar(%s, %s)', :admin, :env1), 'no tiene productos');
SELECT fn_envio_set_linea(:admin, :env1, :lab6, 5);
SELECT fn_envio_set_linea(:admin, :env1, :aro, 6);
SELECT pg_temp.espera_error(format('SELECT fn_envio_set_linea(%s, %s, %s, 1)', :admin, :env1, :lob), 'Solo se envían piezas');
SELECT fn_enviar(:admin, :env1) AS env1_num \gset
SELECT pg_temp.afirma(:'env1_num' ~ '^ENV-[0-9]{6}$', 'el envío recibe número al enviarse (' || :'env1_num' || ')');
SELECT pg_temp.afirma((SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :bod AND variante_id = :lab6) = :bod_lab6 - 5, 'al enviar sale de bodega');
SELECT pg_temp.afirma((SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :lbr AND variante_id = :lab6) = :lbr_lab6, 'en tránsito todavía no entra a la sucursal');
SELECT pg_temp.afirma((SELECT en_transito_entrante FROM v_stock_actual WHERE sucursal_id = :lbr AND variante_id = :lab6) = 5, 'la sucursal ve 5 en camino');
SELECT pg_temp.afirma(fn_stock_total(:lab6) = :total_lab6, 'el stock total (para costo promedio) incluye lo que va en tránsito');
SELECT pg_temp.espera_error(format('SELECT fn_envio_set_linea(%s, %s, %s, 1)', :admin, :env1, :lab6), 'no se puede modificar');
SELECT pg_temp.espera_error(format('SELECT fn_cancelar_envio(%s, %s, %L)', :admin, :env1, 'x'), 'debe recibirse');
-- Recepción en la tablet de Las Brisas
SELECT pg_temp.espera_error(format($q$SELECT * FROM fn_recibir_envio(%s, %s, '[]')$q$, :ana, :env1), 'no está asignado');
SELECT pg_temp.espera_error(format($q$SELECT * FROM fn_recibir_envio(%s, %s, '[{"variante_id":%s,"cantidad":1}]')$q$, :carlos, :env1, :nei), 'no vienen en el envío');
SELECT pg_temp.espera_error(format($q$SELECT * FROM fn_recibir_envio(%s, %s, '[{"variante_id":%s,"cantidad":6}]')$q$, :carlos, :env1, :lab6), 'más piezas de las enviadas');
\echo 'Recepción (aros escaneados uno por uno, faltan 2):'
SELECT * FROM fn_recibir_envio(:carlos, :env1, format(
  '[{"variante_id":%s,"cantidad":5},{"variante_id":%s,"cantidad":1},{"variante_id":%s,"cantidad":1},{"variante_id":%s,"cantidad":1},{"variante_id":%s,"cantidad":1}]',
  :lab6, :aro, :aro, :aro, :aro)::jsonb);
SELECT pg_temp.afirma((SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :lbr AND variante_id = :lab6) = :lbr_lab6 + 5
                  AND (SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :lbr AND variante_id = :aro) = :lbr_aro + 4, 'entra a la sucursal lo recibido (5 labret, 4 de 6 aros)');
SELECT pg_temp.afirma((SELECT estado = 'RECIBIDO_CON_DIFERENCIAS' AND faltantes = 2 FROM v_envios WHERE envio_id = :env1), 'envío cerrado con 2 faltantes');
SELECT pg_temp.afirma(EXISTS (SELECT 1 FROM v_alertas_pendientes WHERE tipo = 'ENVIO_DIFERENCIA' AND (detalle->>'envio_id')::bigint = :env1), 'alerta de diferencia con quién envió y quién recibió');
SELECT pg_temp.espera_error(format($q$SELECT * FROM fn_recibir_envio(%s, %s, '[]')$q$, :carlos, :env1), 'no está en tránsito');
SELECT pg_temp.afirma((SELECT count(*) = 2 FROM movimiento_inventario WHERE envio_id = :env1 AND tipo = 'TRASLADO_SALIDA')
                  AND (SELECT count(*) = 2 FROM movimiento_inventario WHERE envio_id = :env1 AND tipo = 'TRASLADO_ENTRADA'), 'kardex: salidas y entradas enlazadas al envío');
-- Stock insuficiente en el origen: el envío queda en borrador
SELECT fn_crear_envio(:admin, :bod, :lam) AS env2 \gset
SELECT fn_envio_set_linea(:admin, :env2, :cad, 999);
SELECT pg_temp.espera_error(format('SELECT fn_enviar(%s, %s)', :admin, :env2), 'Stock insuficiente');
SELECT pg_temp.afirma((SELECT estado FROM envio WHERE id = :env2) = 'BORRADOR', 'si falta stock el envío sigue en borrador');
SELECT fn_cancelar_envio(:admin, :env2, 'Cantidad equivocada');
SELECT pg_temp.espera_error(format('INSERT INTO movimiento_inventario (sucursal_id, variante_id, tipo, cantidad, stock_resultante, usuario_id) VALUES (%s, %s, %L, 1, 0, %s)', :lam, :aro, 'TRASLADO_ENTRADA', :admin), 'ck_mov_envio');

-- Sugerencia de reparto: Las Brisas no tiene labret con piedra y su mínimo es 3
INSERT INTO stock_sucursal (sucursal_id, variante_id, cantidad, stock_minimo) VALUES (:lbr, :pdr, 0, 3);
\echo 'Sugerencia para repartir 6 labret con piedra:'
SELECT sucursal, stock, stock_minimo, en_transito, vendidas_30d, sugerido FROM fn_sugerir_reparto(:pdr, 6);
SELECT pg_temp.afirma((SELECT sum(sugerido) FROM fn_sugerir_reparto(:pdr, 6)) = 6, 'la sugerencia reparte exactamente lo disponible');
SELECT pg_temp.afirma((SELECT sugerido >= 3 FROM fn_sugerir_reparto(:pdr, 6) WHERE sucursal_id = :lbr), 'primero cubre el mínimo de la sucursal sin stock');
SELECT pg_temp.afirma((SELECT sugerido = 2 FROM fn_sugerir_reparto(:pdr, 2) WHERE sucursal_id = :lbr), 'si no alcanza, todo va a cubrir el mínimo');

-- Mermas: la vendedora reporta, solo el admin aprueba
SELECT cantidad AS lam_lab6 FROM stock_sucursal WHERE sucursal_id = :lam AND variante_id = :lab6 \gset
SELECT fn_reportar_merma(:ana, :lam, :lab6, 1, 'Pieza doblada al abrir el empaque') AS merma1 \gset
SELECT pg_temp.afirma((SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :lam AND variante_id = :lab6) = :lam_lab6, 'reportar la merma no descuenta stock');
SELECT pg_temp.afirma(EXISTS (SELECT 1 FROM v_alertas_pendientes WHERE tipo = 'MERMA_PENDIENTE'), 'merma pendiente avisa al admin');
SELECT pg_temp.espera_error(format('SELECT fn_resolver_merma(%s, %s, true)', :ana, :merma1), 'INVENTARIO_AJUSTAR');
SELECT pg_temp.espera_error(format('SELECT fn_resolver_merma(%s, %s, true)', :maria, :merma1), 'INVENTARIO_AJUSTAR');
SELECT fn_resolver_merma(:admin, :merma1, true, 'Revisada');
SELECT pg_temp.afirma((SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :lam AND variante_id = :lab6) = :lam_lab6 - 1, 'merma aprobada descuenta 1');
SELECT pg_temp.afirma(NOT EXISTS (SELECT 1 FROM v_alertas_pendientes WHERE tipo = 'MERMA_PENDIENTE' AND (detalle->>'merma_id')::bigint = :merma1), 'la alerta de la merma queda atendida');
SELECT pg_temp.espera_error(format('SELECT fn_resolver_merma(%s, %s, false)', :admin, :merma1), 'ya fue aprobada');
SELECT pg_temp.espera_error(format('SELECT fn_reportar_merma(%s, %s, %s, 999, %L)', :ana, :lam, :lab6, 'Se perdieron todas'), 'No hay 999');
SELECT fn_reportar_merma(:ana, :lam, :lab6, 1, 'Cliente dice que se cayó') AS merma2 \gset
SELECT fn_resolver_merma(:admin, :merma2, false, 'Apareció en la vitrina');
SELECT pg_temp.afirma((SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :lam AND variante_id = :lab6) = :lam_lab6 - 1, 'merma rechazada no descuenta');

-- Conteo físico (piercing titanio en Las Américas)
SELECT id AS cat_tit FROM categoria WHERE nombre = 'Piercing titanio' \gset
SELECT cantidad AS lam_lab6 FROM stock_sucursal WHERE sucursal_id = :lam AND variante_id = :lab6 \gset
SELECT cantidad AS lam_lab8 FROM stock_sucursal WHERE sucursal_id = :lam AND variante_id = :lab8 \gset
SELECT fn_iniciar_conteo(:ana, :lam, :cat_tit) AS conteo1 \gset
SELECT pg_temp.espera_error(format('SELECT fn_iniciar_conteo(%s, %s)', :maria, :lam), 'conteo en curso');
SELECT fn_conteo_registrar(:ana, :conteo1, :lab6) FROM generate_series(1, 3);
SELECT pg_temp.afirma(fn_conteo_registrar(:ana, :conteo1, :lab6, 0) = 3, 'escanear suma de a una (3)');
SELECT pg_temp.espera_error(format('SELECT fn_conteo_registrar(%s, %s, %s)', :ana, :conteo1, :nei), 'no corresponde a este conteo');
SELECT fn_enviar_conteo(:ana, :conteo1);
SELECT pg_temp.afirma((SELECT contada = 0 AND diferencia = -:lam_lab8 FROM fn_conteo_diferencias(:conteo1) WHERE variante_id = :lab8), 'lo que no se escaneó cuenta como 0 (faltan ' || :lam_lab8 || ')');
SELECT pg_temp.espera_error(format('SELECT fn_conteo_registrar(%s, %s, %s)', :ana, :conteo1, :lab6), 'no está abierto');
SELECT fn_cancelar_conteo(:ana, :conteo1);
-- Segundo conteo, bien hecho: falta 1 labret 6 mm
SELECT fn_iniciar_conteo(:ana, :lam, :cat_tit) AS conteo2 \gset
SELECT fn_conteo_registrar(:ana, :conteo2, :lab6, :lam_lab6 - 1, false);
SELECT fn_conteo_registrar(:ana, :conteo2, :lab8, :lam_lab8, false);
SELECT fn_enviar_conteo(:ana, :conteo2);
\echo 'Diferencias del conteo:'
SELECT producto, stock_sistema, contada, diferencia, valor_diferencia FROM fn_conteo_diferencias(:conteo2);
SELECT pg_temp.espera_error(format('SELECT fn_aplicar_conteo(%s, %s)', :ana, :conteo2), 'INVENTARIO_AJUSTAR');
SELECT pg_temp.afirma(fn_aplicar_conteo(:admin, :conteo2) = 1, 'el admin aplica 1 ajuste');
SELECT pg_temp.afirma((SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :lam AND variante_id = :lab6) = :lam_lab6 - 1
                  AND (SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :lam AND variante_id = :lab8) = :lam_lab8, 'stock igual al conteo');
SELECT pg_temp.afirma(EXISTS (SELECT 1 FROM movimiento_inventario WHERE motivo = 'Conteo físico #' || :conteo2 AND tipo = 'AJUSTE_NEGATIVO'), 'ajuste en el kardex con referencia al conteo');

\echo '\n=== 15. v1.1 PASO 5: VENTA DE PAQUETES, PROMOCIONES E IDEMPOTENCIA'
SELECT paquete_variante_id AS paq_hlx FROM perforacion WHERE codigo = 'HLX' \gset
SELECT paquete_variante_id AS paq_par FROM perforacion WHERE codigo = 'LOBP' \gset
SELECT servicio_variante_id AS srv_hlx FROM perforacion WHERE codigo = 'HLX' \gset
SELECT cantidad AS lbr_aro FROM stock_sucursal WHERE sucursal_id = :lbr AND variante_id = :aro \gset
SELECT cantidad AS lbr_lab6 FROM stock_sucursal WHERE sucursal_id = :lbr AND variante_id = :lab6 \gset
SELECT costo AS aro_costo FROM variante WHERE id = :aro \gset

-- Hélix con pieza de acero clásica: precio de tabla y la pieza sale del inventario
SELECT fn_registrar_venta(:carlos, :turno_lbr, format('[{"variante_id":%s,"cantidad":1,"piezas":[%s]}]', :paq_hlx, :aro)::jsonb,
  '[{"metodo":"EFECTIVO","monto":500}]') AS vp1 \gset
SELECT pg_temp.afirma((SELECT precio_lista = 450 AND precio_unitario = 450 FROM venta_detalle WHERE venta_id = :vp1), 'hélix + aro clásico se cobra C$450 (tabla)');
SELECT pg_temp.afirma((SELECT costo_unitario FROM venta_detalle WHERE venta_id = :vp1) = :aro_costo, 'costo del paquete = costo de la pieza (servicio sin costo)');
SELECT pg_temp.afirma((SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :lbr AND variante_id = :aro) = :lbr_aro - 1, 'la pieza del paquete se descuenta del inventario');
SELECT pg_temp.afirma(EXISTS (SELECT 1 FROM venta_detalle_pieza vp JOIN venta_detalle d ON d.id = vp.venta_detalle_id WHERE d.venta_id = :vp1 AND vp.variante_id = :aro), 'queda registrada qué pieza se usó');
SELECT pg_temp.afirma((SELECT monto FROM venta_pago WHERE venta_id = :vp1 AND es_vuelto) = -50, 'vuelto de C$50');

-- Titanio: servicio + pieza, y el vendedor puede subirlo pero no bajarlo
SELECT fn_registrar_venta(:carlos, :turno_lbr, format('[{"variante_id":%s,"cantidad":1,"piezas":[%s],"precio":1100}]', :paq_hlx, :lab6)::jsonb,
  '[{"metodo":"TARJETA","monto":1100,"referencia":"55123"}]') AS vp2 \gset
SELECT pg_temp.afirma((SELECT precio_lista = 1000 AND precio_unitario = 1100 FROM venta_detalle WHERE venta_id = :vp2), 'hélix + titanio: lista 350 + 650 = 1000, cobrado 1100');
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":1,"piezas":[%s],"precio":900}]', '[{"metodo":"EFECTIVO","monto":900}]')$q$, :carlos, :turno_lbr, :paq_hlx, :lab6), 'no puede ser menor al establecido');
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":1,"piezas":[%s],"precio":1600}]', '[{"metodo":"EFECTIVO","monto":1600}]')$q$, :carlos, :turno_lbr, :paq_hlx, :lab6), 'aumento máximo');
-- Errores de paquete
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":2,"piezas":[%s]}]', '[{"metodo":"EFECTIVO","monto":900}]')$q$, :carlos, :turno_lbr, :paq_hlx, :aro), 'cantidad 1');
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":1,"piezas":[%s]}]', '[{"metodo":"EFECTIVO","monto":900}]')$q$, :carlos, :turno_lbr, :aro, :aro), 'Solo los paquetes llevan piezas');
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":1,"piezas":[%s]}]', '[{"metodo":"EFECTIVO","monto":900}]')$q$, :carlos, :turno_lbr, :paq_hlx, :pdr), 'Stock insuficiente');
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":1,"piezas":[%s]}]', '[{"metodo":"EFECTIVO","monto":900}]')$q$, :carlos, :turno_lbr, :paq_hlx, :nei), 'no es una pieza de perforación');
-- Lóbulos (par) con 2 aros: 2 piezas del mismo producto
SELECT fn_registrar_venta(:carlos, :turno_lbr, format('[{"variante_id":%s,"cantidad":1,"piezas":[%s,%s]}]', :paq_par, :aro, :aro)::jsonb,
  '[{"metodo":"EFECTIVO","monto":600}]') AS vp3 \gset
SELECT pg_temp.afirma((SELECT precio_unitario = 600 AND costo_unitario = 2 * :aro_costo FROM venta_detalle WHERE venta_id = :vp3), 'lóbulos par: C$600, costo de 2 aros');
SELECT pg_temp.afirma((SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :lbr AND variante_id = :aro) = :lbr_aro - 3, 'salen 2 aros más');
-- Anular un paquete devuelve la pieza
SELECT fn_anular_venta(:admin, :vp3, 'Cliente cambió de opinión');
SELECT pg_temp.afirma((SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :lbr AND variante_id = :aro) = :lbr_aro - 1, 'anular el paquete devuelve las 2 piezas');
-- Paquete + solo servicio + pieza suelta en una misma venta
SELECT fn_registrar_venta(:carlos, :turno_lbr, format('[{"variante_id":%s,"cantidad":1,"piezas":[%s]},{"variante_id":%s,"cantidad":1},{"variante_id":%s,"cantidad":1}]', :paq_hlx, :aro, :srv_hlx, :nei)::jsonb,
  '[{"metodo":"EFECTIVO","monto":1320}]') AS vp4 \gset
SELECT pg_temp.afirma((SELECT total FROM venta WHERE id = :vp4) = 450 + 350 + 520, 'venta mixta: paquete 450 + servicio 350 + NeilMed 520');

-- Promociones
SELECT fn_guardar_promocion(:admin, NULL, 'Diez por ciento', 'PORCENTAJE', 10) AS promo10 \gset
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":1}]', '[{"metodo":"EFECTIVO","monto":650}]', %s)$q$, :carlos, :turno_lbr, :lab6, :promo10), 'no está activa');
SELECT pg_temp.espera_error(format('SELECT fn_set_promocion_activa(%s, %s, true)', :maria, :promo10), 'PROMOCIONES_GESTIONAR');
SELECT fn_set_promocion_activa(:admin, :promo10, true);
SELECT fn_registrar_venta(:carlos, :turno_lbr, format('[{"variante_id":%s,"cantidad":1}]', :lab6)::jsonb,
  '[{"metodo":"EFECTIVO","monto":585}]', :promo10) AS vp5 \gset
SELECT pg_temp.afirma((SELECT subtotal = 650 AND descuento = 65 AND total = 585 FROM venta WHERE id = :vp5), 'el vendedor aplica 10 %: 650 − 65 = 585');
SELECT fn_guardar_promocion(:admin, NULL, 'Mínimo mil', 'MONTO', 100, 1000) AS promo_min \gset
SELECT fn_set_promocion_activa(:admin, :promo_min, true);
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":1}]', '[{"metodo":"EFECTIVO","monto":650}]', %s)$q$, :carlos, :turno_lbr, :lab6, :promo_min), 'compra mínima');
SELECT fn_guardar_promocion(:admin, :promo_min, 'Mínimo mil', 'MONTO', 100, 1000, current_date + 10, current_date + 20);
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":2}]', '[{"metodo":"EFECTIVO","monto":1300}]', %s)$q$, :carlos, :turno_lbr, :lab6, :promo_min), 'no está vigente');
SELECT pg_temp.espera_error(format('SELECT fn_guardar_promocion(%s, NULL, %L, %L, 150)', :admin, 'Imposible', 'PORCENTAJE'), 'ck_promo_pct');
SELECT pg_temp.espera_error(format('INSERT INTO venta (numero, sucursal_id, turno_id, vendedor_id, subtotal, descuento, total, tipo_cambio) VALUES (%L, %s, %s, %s, 100, 10, 90, 36)', 'LBR-X', :lbr, :turno_lbr, :carlos), 'ck_venta_descuento_promo');
\echo 'Promociones disponibles en el POS para una venta de C$800:'
SELECT nombre, tipo, valor, compra_minima, aplica, descuento FROM fn_promociones_disponibles(800);

-- Idempotencia: la misma clave dos veces → una sola venta
SELECT count(*) AS ventas_antes FROM venta \gset
SELECT cantidad AS lbr_nei FROM stock_sucursal WHERE sucursal_id = :lbr AND variante_id = :nei \gset
SELECT ultimo_numero_venta AS lbr_num FROM sucursal WHERE id = :lbr \gset
-- El primer intento falla (pago insuficiente): no queda venta y su número de factura sigue libre
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":1}]', '[{"metodo":"EFECTIVO","monto":100}]', NULL, NULL, NULL, NULL, 'a1b2c3d4-0000-4000-8000-000000000001')$q$, :carlos, :turno_lbr, :nei), 'Pago insuficiente');
SELECT pg_temp.afirma((SELECT ultimo_numero_venta FROM sucursal WHERE id = :lbr) = :lbr_num, 'la venta que falla no consume número de factura');
SELECT fn_registrar_venta(:carlos, :turno_lbr, format('[{"variante_id":%s,"cantidad":1}]', :nei)::jsonb,
  '[{"metodo":"EFECTIVO","monto":520}]', NULL, NULL, NULL, NULL, 'a1b2c3d4-0000-4000-8000-000000000001') AS vi1 \gset
SELECT fn_registrar_venta(:carlos, :turno_lbr, format('[{"variante_id":%s,"cantidad":1}]', :nei)::jsonb,
  '[{"metodo":"EFECTIVO","monto":520}]', NULL, NULL, NULL, NULL, 'a1b2c3d4-0000-4000-8000-000000000001') AS vi2 \gset
SELECT pg_temp.afirma(:vi1 = :vi2, 'el doble clic devuelve la misma venta');
SELECT pg_temp.afirma((SELECT count(*) FROM venta) = :ventas_antes + 1, 'solo se creó una venta');
SELECT pg_temp.afirma((SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :lbr AND variante_id = :nei) = :lbr_nei - 1, 'el stock bajó una sola vez');
SELECT pg_temp.afirma((SELECT numero FROM venta WHERE id = :vi1) = 'LBR-' || lpad((:lbr_num + 1)::text, 8, '0'), 'el reintento de la venta que falló toma el número siguiente, sin salto');
SELECT pg_temp.afirma((SELECT ultimo_numero_venta FROM sucursal WHERE id = :lbr) = :lbr_num + 1, 'repetir la clave no consume otro número de factura');
-- El número se toma en la misma transacción de la venta: si quien llama la deshace, vuelve a quedar libre
BEGIN;
SELECT fn_registrar_venta(:carlos, :turno_lbr, format('[{"variante_id":%s,"cantidad":1}]', :nei)::jsonb,
  '[{"metodo":"EFECTIVO","monto":520}]', NULL, NULL, NULL, NULL, 'a1b2c3d4-0000-4000-8000-000000000002') AS vi3 \gset
SELECT pg_temp.afirma((SELECT numero FROM venta WHERE id = :vi3) = 'LBR-' || lpad((:lbr_num + 2)::text, 8, '0'), 'dentro de su transacción la venta ya tiene el número siguiente');
ROLLBACK;
SELECT pg_temp.afirma((SELECT ultimo_numero_venta FROM sucursal WHERE id = :lbr) = :lbr_num + 1
                  AND NOT EXISTS (SELECT 1 FROM venta WHERE clave_idempotencia = 'a1b2c3d4-0000-4000-8000-000000000002'),
                  'si la transacción se deshace, ni la venta ni su número quedan tomados');

-- Reportes nuevos
\echo 'Perforaciones: con pieza vs solo servicio'
SELECT sucursal, perforacion, modalidad, cantidad, venta_neta, margen FROM v_ventas_perforacion ORDER BY perforacion, modalidad;
\echo 'Paquetes por gama'
SELECT sucursal, gama, paquetes, venta_neta, margen FROM v_ventas_gama ORDER BY gama;
\echo 'Piezas consumidas en paquetes'
SELECT sucursal, pieza, gama, unidades, costo FROM v_piezas_consumidas_paquete;
\echo 'Promociones'
SELECT sucursal, promocion, ventas, subtotal, descuento, total FROM v_ventas_promocion ORDER BY promocion;
SELECT pg_temp.afirma((SELECT sum(cantidad) FROM v_ventas_perforacion WHERE perforacion = 'Hélix' AND modalidad = 'CON_PIEZA') = 3, 'reporte: 3 hélix con pieza');
SELECT pg_temp.afirma((SELECT unidades FROM v_piezas_consumidas_paquete WHERE variante_id = :aro AND sucursal_id = :lbr) = 2, 'reporte: 2 aros consumidos en paquetes (la anulada no cuenta)');
SELECT pg_temp.afirma((SELECT vendidas_30d FROM fn_sugerir_reparto(:aro, 1) WHERE sucursal_id = :lbr) >=
                      (SELECT coalesce(sum(vd.cantidad), 0) FROM venta_detalle vd JOIN venta v ON v.id = vd.venta_id WHERE v.estado = 'COMPLETADA' AND v.sucursal_id = :lbr AND vd.variante_id = :aro) + 2,
                      'la sugerencia de reparto cuenta también las piezas vendidas en paquetes');

\echo '\n=== 16. v1.1 PASO 6: CIERRE DE CAJA (DENOMINACIONES, RETIRO, TOLERANCIA, APERTURA Y ALERTAS)'
SELECT set_config('app.usuario_id', :'admin', false);
SELECT monto_esperado AS lbr_nio FROM fn_resumen_turno(:turno_lbr) r JOIN metodo_pago m ON m.id = r.metodo_pago_id WHERE m.es_efectivo AND r.moneda = 'NIO' \gset
SELECT coalesce((SELECT monto_esperado FROM fn_resumen_turno(:turno_lbr) WHERE metodo = 'Tarjeta'), 0) AS lbr_tarjeta \gset
\echo 'Esperado en Las Brisas (lo ve solo el admin/encargado):'
SELECT metodo, moneda, monto_esperado FROM fn_resumen_turno(:turno_lbr);
-- Conteo con monedas de C$1 para poder representar cualquier monto; faltan C$500
SELECT format('[{"moneda":"NIO","valor":1,"cantidad":%s}]', floor(:lbr_nio) - 500) AS conteo_corto \gset
SELECT pg_temp.espera_error(format($q$SELECT fn_cerrar_turno(%s, %s, '[{"moneda":"NIO","valor":3,"cantidad":1}]')$q$, :carlos, :turno_lbr), 'Denominación o cantidad inválida');
SELECT pg_temp.espera_error(format($q$SELECT fn_cerrar_turno(%s, %s, '[]', '[{"metodo":"CHEQUE","monto":10}]')$q$, :carlos, :turno_lbr), 'Método de pago o monto inválido en el arqueo: CHEQUE');
SELECT pg_temp.espera_error(format($q$SELECT fn_cerrar_turno(%s, %s, '[]', '[{"metodo":"EFECTIVO","monto":10}]')$q$, :carlos, :turno_lbr), 'Método de pago o monto inválido en el arqueo: EFECTIVO');
SELECT pg_temp.espera_error(format($q$SELECT fn_cerrar_turno(%s, %s, %L, %L, 999999)$q$, :carlos, :turno_lbr, :'conteo_corto', format('[{"metodo":"TARJETA","monto":%s}]', :lbr_tarjeta)), 'más efectivo del contado');
-- Primer conteo que no cuadra y sin justificación: la caja no se cierra y no se dice cuánto falta
SELECT fn_cerrar_turno(:carlos, :turno_lbr, :'conteo_corto', format('[{"metodo":"TARJETA","monto":%s}]', :lbr_tarjeta)::jsonb, 0) AS intento1 \gset
SELECT pg_temp.afirma(:'intento1'::jsonb = '{"cerrado": false}', 'el primer conteo que no cuadra no cierra la caja y no dice montos');
SELECT pg_temp.afirma((SELECT estado = 'ABIERTO' AND intentos_cierre = 1 FROM turno_caja WHERE id = :turno_lbr)
                  AND NOT EXISTS (SELECT 1 FROM cierre_denominacion WHERE turno_id = :turno_lbr)
                  AND NOT EXISTS (SELECT 1 FROM cierre_caja_detalle WHERE turno_id = :turno_lbr), 'del conteo que no cuadró solo queda anotado el intento');
-- Hay un solo reconteo: desde el segundo conteo la justificación es obligatoria, cuadre o no
SELECT format('[{"moneda":"NIO","valor":1,"cantidad":%s}]', floor(:lbr_nio)) AS conteo_bueno \gset
SELECT pg_temp.espera_error(format($q$SELECT fn_cerrar_turno(%s, %s, %L, %L, 0)$q$, :carlos, :turno_lbr, :'conteo_corto', format('[{"metodo":"TARJETA","monto":%s}]', :lbr_tarjeta)), 'Ya se hizo un reconteo');
SELECT pg_temp.espera_error(format($q$SELECT fn_cerrar_turno(%s, %s, %L, %L, 0)$q$, :carlos, :turno_lbr, :'conteo_bueno', format('[{"metodo":"TARJETA","monto":%s}]', :lbr_tarjeta)), 'Ya se hizo un reconteo');
SELECT pg_temp.afirma((SELECT estado = 'ABIERTO' AND intentos_cierre = 1 FROM turno_caja WHERE id = :turno_lbr), 'sin justificación el segundo conteo ni se mira: responde igual cuadre o no');
SELECT fn_cerrar_turno(:carlos, :turno_lbr, :'conteo_corto', format('[{"metodo":"TARJETA","monto":%s}]', :lbr_tarjeta)::jsonb,
                       floor(:lbr_nio) - 800, 0, 'Se pagó al técnico del aire acondicionado sin registrar el egreso') AS ticket2 \gset
SELECT pg_temp.afirma((:'ticket2'::jsonb->>'cerrado')::boolean AND (:'ticket2'::jsonb->>'fondo_siguiente_nio')::numeric = 300, 'con la justificación se cierra con lo contado: queda C$300 de fondo en Las Brisas');
SELECT pg_temp.afirma(EXISTS (SELECT 1 FROM v_alertas_pendientes WHERE tipo = 'CAJA_DIFERENCIA' AND (detalle->>'turno_id')::bigint = :turno_lbr
                               AND (detalle->>'diferencia_total_nio')::numeric <= -500 AND (detalle->>'hubo_reconteo')::boolean), 'diferencia mayor a C$100: alerta al admin con la justificación');
SELECT pg_temp.afirma((SELECT justificacion_diferencia IS NOT NULL AND retiro_nio = floor(:lbr_nio) - 800 FROM turno_caja WHERE id = :turno_lbr), 'justificación y retiro guardados');

-- Apertura siguiente: se sugiere el fondo y se registra cualquier diferencia
SELECT pg_temp.afirma((SELECT fondo_nio = 300 AND fondo_usd = 0 FROM fn_fondo_sugerido(:caja_lbr)), 'al abrir se sugiere el fondo que dejó el cierre (C$300)');
SELECT fn_abrir_turno(:carlos, :caja_lbr, 250, 0) AS turno_lbr2 \gset
SELECT pg_temp.afirma((SELECT diferencia_apertura_nio FROM turno_caja WHERE id = :turno_lbr2) = -50, 'apertura con C$50 menos: queda registrado');
SELECT pg_temp.afirma(NOT EXISTS (SELECT 1 FROM alerta WHERE tipo = 'CAJA_DIFERENCIA_APERTURA' AND (detalle->>'turno_id')::bigint = :turno_lbr2), 'diferencia de apertura dentro de tolerancia: sin alerta');
SELECT pg_temp.espera_error(format('SELECT fn_abrir_turno(%s, %s, 250)', :carlos, :caja_lbr), 'ya tiene un turno abierto');
SELECT fn_cerrar_turno(:carlos, :turno_lbr2, '[{"moneda":"NIO","valor":200,"cantidad":1},{"moneda":"NIO","valor":50,"cantidad":1}]');
SELECT fn_abrir_turno(:carlos, :caja_lbr, 50, 0) AS turno_lbr3 \gset
SELECT pg_temp.afirma(EXISTS (SELECT 1 FROM v_alertas_pendientes WHERE tipo = 'CAJA_DIFERENCIA_APERTURA' AND (detalle->>'turno_id')::bigint = :turno_lbr3), 'apertura con C$200 menos: alerta al admin');

-- Caja sin cerrar y cierre forzado
SELECT pg_temp.afirma(fn_alertar_cajas_sin_cerrar(now() + interval '1 day') >= 1, 'al día siguiente se alerta la caja sin cerrar');
SELECT pg_temp.afirma(fn_alertar_cajas_sin_cerrar(now() + interval '1 day') = 0, 'una sola alerta por turno');
SELECT pg_temp.espera_error(format('SELECT fn_cierre_forzado(%s, %s, %L)', :maria, :turno_lbr3, 'Nadie cerró anoche'), 'CAJA_CIERRE_FORZADO');
SELECT fn_cierre_forzado(:admin, :turno_lbr3, 'Nadie cerró anoche la caja');
SELECT pg_temp.afirma((SELECT cierre_forzado AND fondo_siguiente_nio = 50 FROM turno_caja WHERE id = :turno_lbr3), 'cierre forzado: se asume lo esperado como fondo (C$50)');
SELECT pg_temp.afirma(NOT EXISTS (SELECT 1 FROM v_alertas_pendientes WHERE tipo = 'CAJA_SIN_CERRAR' AND (detalle->>'turno_id')::bigint = :turno_lbr3), 'la alerta de caja sin cerrar queda atendida');
SELECT pg_temp.espera_error(format('DELETE FROM cierre_denominacion WHERE turno_id = %s', :turno_lbr), 'solo inserción');

\echo 'Turnos (vista del admin):'
SELECT turno_id, sucursal, estado, ventas, total_vendido, diferencia_nio, diferencia_apertura_nio AS dif_apertura, retiro_nio, fondo_siguiente_nio AS fondo, cierre_forzado FROM v_turnos ORDER BY turno_id;

\echo '\n=== 17. LOGIN, SESIONES Y EQUIPOS (backend B2)'
SELECT set_config('app.usuario_id', :'admin', false);
SELECT fn_registrar_dispositivo(:admin, 'Caja 2 Las Américas', 'CAJA', :lam, encode(sha256('login-caja-lam'), 'hex'), :caja_lam) AS eq_lam \gset
SELECT fn_registrar_dispositivo(:admin, 'Tablet 2 Las Brisas', 'TABLET', :lbr, encode(sha256('login-tablet-lbr'), 'hex')) AS eq_lbr \gset
-- Usuario propio de esta sección (vendedor de Las Américas): no depende del estado de los anteriores
SELECT fn_crear_usuario(:admin, 'Luis Pérez', 'luis.perez', 'hash-de-prueba', 'VENDEDOR', ARRAY[:lam]) AS luis \gset

-- Desde qué equipo se puede entrar
SELECT pg_temp.afirma((SELECT resultado FROM fn_registrar_login('luis.perez', true, '10.0.0.7', 'prueba', :'eq_lam')) = 'OK', 'vendedor entra desde la caja registrada de su sucursal');
SELECT pg_temp.afirma((SELECT resultado FROM fn_registrar_login('luis.perez', true)) = 'EQUIPO_NO_AUTORIZADO', 'vendedor sin equipo registrado → no entra');
SELECT pg_temp.afirma((SELECT resultado FROM fn_registrar_login('luis.perez', true, NULL, NULL, :'eq_lbr')) = 'EQUIPO_NO_AUTORIZADO', 'vendedor desde el equipo de otra sucursal → no entra');
SELECT pg_temp.afirma((SELECT resultado FROM fn_registrar_login('ADMIN ', true)) = 'OK', 'el admin entra sin equipo (usuario sin distinguir mayúsculas ni espacios)');
SELECT pg_temp.afirma(EXISTS (SELECT 1 FROM acceso_log WHERE usuario_id = :luis AND exito AND dispositivo_id = :'eq_lam' AND ip = '10.0.0.7')
                  AND EXISTS (SELECT 1 FROM acceso_log WHERE usuario_id = :luis AND NOT exito AND motivo = 'equipo no autorizado'),
                  'la bitácora guarda equipo, IP y motivo de cada intento');
SELECT pg_temp.afirma((SELECT resultado = 'CREDENCIALES_INVALIDAS' AND id_usuario IS NULL FROM fn_registrar_login('no.existe', false)), 'usuario inexistente → credenciales inválidas');

-- Bloqueo por intentos
SELECT fn_registrar_login('luis.perez', false) FROM generate_series(1, 4);
SELECT pg_temp.afirma((SELECT intentos_fallidos = 4 AND bloqueado_hasta IS NULL FROM usuario WHERE id = :luis), '4 fallos: todavía no se bloquea');
SELECT pg_temp.afirma((SELECT resultado = 'BLOQUEADO' AND minutos_bloqueo = 15 FROM fn_registrar_login('luis.perez', false)), 'el 5.º fallo bloquea 15 minutos');
SELECT pg_temp.afirma((SELECT resultado FROM fn_registrar_login('luis.perez', true, NULL, NULL, :'eq_lam')) = 'BLOQUEADO', 'bloqueado: ni la contraseña correcta entra');
SELECT fn_registrar_login('luis.perez', false);
SELECT pg_temp.afirma((SELECT intentos_fallidos = 5 AND bloqueado_hasta < now() + interval '15 minutes' FROM usuario WHERE id = :luis), 'mientras dura el bloqueo no se cuentan más fallos ni se alarga');
UPDATE usuario SET bloqueado_hasta = now() - interval '1 minute' WHERE id = :luis;  -- simula que pasaron los 15 minutos
-- (cada llamada que modifica datos va en su propia sentencia: una misma sentencia no ve sus propios cambios)
SELECT resultado AS r FROM fn_registrar_login('luis.perez', false) \gset
SELECT pg_temp.afirma(:'r' = 'CREDENCIALES_INVALIDAS'
                  AND (SELECT intentos_fallidos = 1 AND bloqueado_hasta IS NULL FROM usuario WHERE id = :luis), 'cumplido el bloqueo, el contador vuelve a empezar');
SELECT resultado AS r FROM fn_registrar_login('luis.perez', true, NULL, NULL, :'eq_lam') \gset
SELECT pg_temp.afirma(:'r' = 'OK'
                  AND (SELECT intentos_fallidos = 0 AND ultimo_acceso IS NOT NULL FROM usuario WHERE id = :luis), 'login correcto reinicia el contador');
SELECT fn_set_usuario_activo(:admin, :luis, false);
SELECT pg_temp.afirma((SELECT resultado FROM fn_registrar_login('luis.perez', true, NULL, NULL, :'eq_lam')) = 'INACTIVO', 'usuario inactivo con contraseña correcta → INACTIVO');
SELECT resultado AS r FROM fn_registrar_login('luis.perez', false, NULL, NULL, :'eq_lam') \gset
SELECT pg_temp.afirma(:'r' = 'CREDENCIALES_INVALIDAS'
                  AND (SELECT intentos_fallidos FROM usuario WHERE id = :luis) = 0, 'usuario inactivo con contraseña incorrecta: no revela su estado ni cuenta');
SELECT fn_set_usuario_activo(:admin, :luis, true);

-- Duración de la sesión
SELECT * FROM fn_crear_sesion(:luis, encode(sha256('s1'), 'hex'), :'eq_lam', '10.0.0.7', 'prueba');
SELECT pg_temp.afirma((SELECT expira_at BETWEEN now() + interval '11 hours 59 minutes' AND now() + interval '12 hours 1 minute'
                         FROM sesion WHERE refresh_token_hash = encode(sha256('s1'), 'hex')), 'sesión en un equipo registrado: 12 horas');
SELECT * FROM fn_crear_sesion(:admin, encode(sha256('s-admin'), 'hex'));
SELECT pg_temp.afirma((SELECT expira_at BETWEEN now() + interval '6 days 23 hours' AND now() + interval '7 days 1 hour'
                         FROM sesion WHERE refresh_token_hash = encode(sha256('s-admin'), 'hex')), 'sesión del admin sin equipo: 7 días');
SELECT pg_temp.espera_error(format('SELECT fn_crear_sesion(%s, %L)', :luis, repeat('f', 64)), 'no puede iniciar sesión desde este equipo');

-- Renovación con rotación
SELECT * FROM fn_renovar_sesion(encode(sha256('s1'), 'hex'), encode(sha256('s2'), 'hex'), '10.0.0.8', 'prueba') \gset r_
SELECT pg_temp.afirma(:r_usuario_id = :luis AND :'r_dispositivo_id' = :'eq_lam', 'renovar conserva usuario y equipo');
SELECT pg_temp.afirma((SELECT v.revocada_at IS NOT NULL AND v.reemplazada_por = n.id AND n.expira_at = v.expira_at AND n.revocada_at IS NULL
                         FROM sesion v JOIN sesion n ON n.refresh_token_hash = encode(sha256('s2'), 'hex')
                        WHERE v.refresh_token_hash = encode(sha256('s1'), 'hex')), 'la sesión vieja apunta a la nueva y el vencimiento no se alarga');
SELECT count(*) AS n FROM fn_renovar_sesion(encode(sha256('s1'), 'hex'), encode(sha256('s3'), 'hex')) \gset
SELECT pg_temp.afirma(:n = 0 AND (SELECT revocada_at IS NULL FROM sesion WHERE refresh_token_hash = encode(sha256('s2'), 'hex')),
                  'un token ya usado no sirve otra vez (si es inmediato, no cierra las demás sesiones)');
UPDATE sesion SET revocada_at = now() - interval '1 minute' WHERE refresh_token_hash = encode(sha256('s1'), 'hex');
SELECT count(*) AS n FROM fn_renovar_sesion(encode(sha256('s1'), 'hex'), encode(sha256('s4'), 'hex'), '203.0.113.9') \gset
SELECT pg_temp.afirma(:n = 0 AND (SELECT revocada_at IS NOT NULL FROM sesion WHERE refresh_token_hash = encode(sha256('s2'), 'hex')),
                  'reusar un token ya renovado cierra todas las sesiones del usuario');
SELECT pg_temp.afirma(EXISTS (SELECT 1 FROM v_alertas_pendientes WHERE tipo = 'SESION_REUTILIZADA' AND (detalle->>'usuario_id')::bigint = :luis
                                AND detalle->>'ip' = '203.0.113.9'), 'posible robo de sesión: alerta al admin');
SELECT * FROM fn_crear_sesion(:luis, encode(sha256('s5'), 'hex'), :'eq_lam');
UPDATE sesion SET expira_at = now() - interval '1 minute' WHERE refresh_token_hash = encode(sha256('s5'), 'hex');
SELECT pg_temp.afirma(NOT EXISTS (SELECT 1 FROM fn_renovar_sesion(encode(sha256('s5'), 'hex'), encode(sha256('s6'), 'hex'))), 'sesión vencida no se renueva');
SELECT pg_temp.afirma(NOT EXISTS (SELECT 1 FROM fn_renovar_sesion(encode(sha256('no-existe'), 'hex'), encode(sha256('s6'), 'hex'))), 'token desconocido no se renueva');

-- Equipo desactivado y vendedor que cambia de sucursal
SELECT * FROM fn_crear_sesion(:luis, encode(sha256('s7'), 'hex'), :'eq_lam');
SELECT fn_set_dispositivo_activo(:admin, :'eq_lam', false);
SELECT pg_temp.afirma((SELECT revocada_at IS NOT NULL FROM sesion WHERE refresh_token_hash = encode(sha256('s7'), 'hex')), 'desactivar el equipo cierra sus sesiones');
SELECT pg_temp.afirma((SELECT resultado FROM fn_registrar_login('luis.perez', true, NULL, NULL, :'eq_lam')) = 'EQUIPO_NO_AUTORIZADO', 'equipo desactivado → no se puede entrar desde él');
SELECT fn_set_dispositivo_activo(:admin, :'eq_lam', true);
SELECT * FROM fn_crear_sesion(:luis, encode(sha256('s8'), 'hex'), :'eq_lam');
SELECT fn_actualizar_usuario(:admin, :luis, 'Luis Pérez', 'VENDEDOR', ARRAY[:lbr]);
SELECT count(*) AS n FROM fn_renovar_sesion(encode(sha256('s8'), 'hex'), encode(sha256('s9'), 'hex')) \gset
SELECT pg_temp.afirma(:n = 0 AND (SELECT revocada_at IS NOT NULL FROM sesion WHERE refresh_token_hash = encode(sha256('s8'), 'hex')),
                  'si el vendedor deja la sucursal, la sesión en su equipo ya no se renueva');
SELECT fn_actualizar_usuario(:admin, :luis, 'Luis Pérez', 'VENDEDOR', ARRAY[:lam]);

-- Cierre de sesión
SELECT pg_temp.afirma(fn_cerrar_sesion(encode(sha256('s-admin'), 'hex')), 'logout cierra la sesión');
SELECT pg_temp.afirma(NOT fn_cerrar_sesion(encode(sha256('s-admin'), 'hex')), 'logout repetido no hace nada');
SELECT count(*) AS n FROM fn_renovar_sesion(encode(sha256('s-admin'), 'hex'), encode(sha256('s10'), 'hex')) \gset
SELECT pg_temp.afirma(:n = 0 AND NOT EXISTS (SELECT 1 FROM alerta WHERE tipo = 'SESION_REUTILIZADA' AND (detalle->>'usuario_id')::bigint = :admin),
                  'tras el logout el token no renueva, sin falsa alarma de robo');

-- Cambio de contraseña
SELECT fn_resetear_password(:admin, :luis, 'hash-temporal');
SELECT * FROM fn_crear_sesion(:luis, encode(sha256('s11'), 'hex'), :'eq_lam');
SELECT fn_cambiar_password(:luis, 'hash-definitivo');
SELECT pg_temp.afirma((SELECT password_hash = 'hash-definitivo' AND NOT debe_cambiar_password FROM usuario WHERE id = :luis), 'cambiar la contraseña quita la obligación de cambiarla');
SELECT pg_temp.afirma((SELECT revocada_at IS NOT NULL FROM sesion WHERE refresh_token_hash = encode(sha256('s11'), 'hex')), 'cambiar la contraseña cierra las sesiones abiertas');
SELECT fn_set_usuario_activo(:admin, :luis, false);
SELECT pg_temp.espera_error(format('SELECT fn_cambiar_password(%s, %L)', :luis, 'otro-hash'), 'no existe o está inactivo');
SELECT pg_temp.espera_error($$UPDATE parametro SET valor = 'doce' WHERE clave = 'SESION_HORAS_EQUIPO'$$, 'debe ser un número positivo');

\echo '\n=== 18. PANEL DE ADMINISTRACIÓN: PARÁMETROS Y PERMISOS DE ROLES (backend B3)'
SELECT set_config('app.usuario_id', :'admin', false);

-- Parámetros: la función exige el permiso; el formato lo sigue validando el trigger
SELECT pg_temp.espera_error(format('SELECT fn_set_parametro(%s, %L, %L)', :maria, 'MARGEN_MINIMO_ALERTA_PCT', '10'), 'PARAMETROS_GESTIONAR');
SELECT pg_temp.espera_error(format('SELECT fn_set_parametro(%s, %L, %L)', :admin, 'NO_EXISTE', '10'), 'El parámetro NO_EXISTE no existe');
SELECT pg_temp.espera_error(format('SELECT fn_set_parametro(%s, %L, %L)', :admin, 'MARGEN_MINIMO_ALERTA_PCT', 'mucho'), 'debe ser un número');
SELECT pg_temp.espera_error(format('SELECT fn_set_parametro(%s, %L, NULL)', :admin, 'MARGEN_MINIMO_ALERTA_PCT'), 'no puede quedar vacío');
SELECT fn_set_parametro(:admin, ' margen_minimo_alerta_pct ', ' 35 ');
SELECT pg_temp.afirma(fn_parametro_num('MARGEN_MINIMO_ALERTA_PCT') = 35, 'fn_set_parametro guarda el valor limpio (la clave no distingue mayúsculas)');
SELECT pg_temp.afirma((SELECT usuario_id = :admin AND despues->>'valor' = '35' FROM auditoria
                        WHERE tabla = 'parametro' AND registro_id = 'MARGEN_MINIMO_ALERTA_PCT' ORDER BY id DESC LIMIT 1),
                      'el cambio del parámetro queda auditado con quién lo hizo');
SELECT fn_set_parametro(:admin, 'MARGEN_MINIMO_ALERTA_PCT', '40');
SELECT fn_set_parametro(:admin, 'VENTA_SOBREPRECIO_MAX_PCT', '');
SELECT pg_temp.afirma(fn_parametro_num('VENTA_SOBREPRECIO_MAX_PCT') IS NULL, 'un parámetro que permite vacío puede quedar sin valor');
SELECT fn_set_parametro(:admin, 'VENTA_SOBREPRECIO_MAX_PCT', '50');

-- Permisos de los roles
SELECT permisos AS perm_enc FROM v_roles_admin WHERE codigo = 'ENCARGADO' \gset
SELECT permisos AS perm_ven FROM v_roles_admin WHERE codigo = 'VENDEDOR'  \gset
SELECT pg_temp.afirma((SELECT cardinality(permisos) = (SELECT count(*) FROM permiso) AND NOT editable FROM v_roles_admin WHERE codigo = 'ADMIN'),
                      'el rol ADMIN aparece con todos los permisos y no es editable');
SELECT pg_temp.afirma((SELECT editable AND usuarios_activos = 1 AND 'VENTAS_ANULAR' = ANY (permisos) AND NOT 'USUARIOS_VER' = ANY (permisos)
                         FROM v_roles_admin WHERE codigo = 'ENCARGADO'), 'el rol ENCARGADO es editable y muestra sus permisos y usuarios activos');
SELECT pg_temp.espera_error(format('SELECT fn_set_permisos_rol(%s, %L, %L)', :maria, 'VENDEDOR', '{}'), 'ROLES_GESTIONAR');
SELECT pg_temp.espera_error(format('SELECT fn_set_permisos_rol(%s, %L, %L)', :admin, 'ADMIN', '{}'), 'no se puede modificar');
SELECT pg_temp.espera_error(format('SELECT fn_set_permisos_rol(%s, %L, %L)', :admin, 'GERENTE', '{}'), 'Rol inexistente');
SELECT pg_temp.espera_error(format('SELECT fn_set_permisos_rol(%s, %L, %L)', :admin, 'ENCARGADO', '{VENTAS_REGISTRAR,VOLAR,ALGO_MAS}'), 'Permiso inexistente: ALGO_MAS, VOLAR');

SELECT count(*) AS aud_antes FROM auditoria WHERE tabla = 'rol_permiso' \gset
SELECT fn_set_permisos_rol(:admin, 'encargado', :'perm_enc'::text[] || ARRAY['usuarios_ver', 'ROLES_GESTIONAR', 'USUARIOS_VER']);
SELECT pg_temp.afirma(fn_tiene_permiso(:maria, 'USUARIOS_VER') AND fn_tiene_permiso(:maria, 'ROLES_GESTIONAR') AND fn_tiene_permiso(:maria, 'VENTAS_ANULAR'),
                      'el admin agrega permisos al rol ENCARGADO y se conservan los que tenía');
SELECT pg_temp.afirma((SELECT count(*) FROM auditoria WHERE tabla = 'rol_permiso') = :aud_antes + 2, 'solo se auditan las diferencias (2 permisos agregados)');

-- Con ROLES_GESTIONAR la encargada reparte los permisos que ella tiene, pero no puede darse (ni dar) los que no tiene
SELECT pg_temp.espera_error(format('SELECT fn_set_permisos_rol(%s, %L, %L)', :maria, 'ENCARGADO', '{ROLES_GESTIONAR,USUARIOS_GESTIONAR,PARAMETROS_GESTIONAR}'),
                            'No puede otorgar un permiso que usted no tiene: PARAMETROS_GESTIONAR, USUARIOS_GESTIONAR');
SELECT fn_set_permisos_rol(:admin, 'VENDEDOR', :'perm_ven'::text[] || ARRAY['INVENTARIO_AJUSTAR']);
SELECT fn_set_permisos_rol(:maria, 'VENDEDOR', ARRAY['VENTAS_REGISTRAR', 'VENTAS_ANULAR', 'INVENTARIO_AJUSTAR']);
SELECT pg_temp.afirma(fn_tiene_permiso(:carlos, 'VENTAS_ANULAR') AND fn_tiene_permiso(:carlos, 'INVENTARIO_AJUSTAR') AND NOT fn_tiene_permiso(:carlos, 'CAJA_ABRIR'),
                      'la encargada otorga lo que ella tiene, respeta lo que el rol ya tenía y quita lo que no va en la lista');
SELECT pg_temp.espera_error(format('SELECT fn_set_permisos_rol(%s, %L, %L)', :maria, 'VENDEDOR', '{VENTAS_REGISTRAR,INVENTARIO_ENTRADA}'),
                            'No puede otorgar un permiso que usted no tiene: INVENTARIO_ENTRADA');

-- Con USUARIOS_GESTIONAR la encargada administra a los vendedores, pero no puede tocar a un administrador
SELECT fn_set_permisos_rol(:admin, 'ENCARGADO', :'perm_enc'::text[] || ARRAY['USUARIOS_GESTIONAR']);
SELECT pg_temp.espera_error(format('SELECT fn_resetear_password(%s, %s, %L)', :maria, :admin, 'hash-ajeno'), 'Solo un administrador puede modificar a otro administrador');
SELECT pg_temp.espera_error(format('SELECT fn_set_usuario_activo(%s, %s, false)', :maria, :admin), 'Solo un administrador puede modificar a otro administrador');
SELECT pg_temp.espera_error(format('SELECT fn_revocar_sesiones(%s, %s)', :maria, :admin), 'Solo un administrador puede modificar a otro administrador');
SELECT pg_temp.espera_error(format('SELECT fn_actualizar_usuario(%s, %s, %L, %L, %L)', :maria, :admin, 'Administrador', 'VENDEDOR', '{}'), 'Solo un administrador puede modificar a otro administrador');
SELECT pg_temp.espera_error(format('SELECT fn_crear_usuario(%s, %L, %L, %L, %L)', :maria, 'Otra Jefa', 'otra.jefa', 'hash', 'ADMIN'), 'Solo un administrador puede asignar el rol ADMIN');
SELECT pg_temp.afirma((SELECT password_hash <> 'hash-ajeno' AND activo FROM usuario WHERE id = :admin), 'el administrador sigue intacto');
SELECT fn_resetear_password(:maria, :carlos, 'hash-temporal-carlos');
SELECT pg_temp.afirma((SELECT password_hash = 'hash-temporal-carlos' AND debe_cambiar_password FROM usuario WHERE id = :carlos),
                      'con USUARIOS_GESTIONAR la encargada sí puede resetear la contraseña de un vendedor');

SELECT fn_set_permisos_rol(:admin, 'VENDEDOR', :'perm_ven'::text[]);
SELECT fn_set_permisos_rol(:admin, 'ENCARGADO', :'perm_enc'::text[]);
SELECT pg_temp.afirma((SELECT permisos = :'perm_enc'::text[] FROM v_roles_admin WHERE codigo = 'ENCARGADO')
                  AND (SELECT permisos = :'perm_ven'::text[] FROM v_roles_admin WHERE codigo = 'VENDEDOR')
                  AND NOT fn_tiene_permiso(:maria, 'ROLES_GESTIONAR'), 'los roles vuelven a sus permisos originales');

\echo '\n=== 19. CATÁLOGO: CATEGORÍAS, PRODUCTOS, VARIANTES, GAMAS Y PERFORACIONES (backend B4)'
SELECT set_config('app.usuario_id', :'admin', false);

-- Categorías
SELECT pg_temp.espera_error(format('SELECT fn_guardar_categoria(%s, NULL, %L)', :maria, 'Relojes'), 'PRODUCTOS_GESTIONAR');
SELECT fn_guardar_categoria(:admin, NULL, '  Relojes ', ' Relojes de pulsera ') AS cat_rel \gset
SELECT pg_temp.afirma((SELECT nombre = 'Relojes' AND descripcion = 'Relojes de pulsera' AND activa FROM categoria WHERE id = :cat_rel), 'categoría nueva, con el texto limpio');
SELECT pg_temp.espera_error(format('SELECT fn_guardar_categoria(%s, NULL, %L)', :admin, 'Relojes'), 'duplicate key');
SELECT fn_guardar_categoria(:admin, :cat_rel, 'Relojes y pulseras', '');
SELECT pg_temp.afirma((SELECT nombre = 'Relojes y pulseras' AND descripcion IS NULL FROM categoria WHERE id = :cat_rel), 'categoría editada (descripción vacía → sin descripción)');
SELECT pg_temp.espera_error(format('SELECT fn_guardar_categoria(%s, 999999, %L)', :admin, 'Nada'), 'La categoría 999999 no existe');
SELECT id AS cat_perf FROM categoria WHERE nombre = 'Perforaciones' \gset
SELECT pg_temp.espera_error(format('SELECT fn_guardar_categoria(%s, %s, %L)', :admin, :cat_perf, 'Piercings'), 'no se puede renombrar');
SELECT pg_temp.espera_error(format('SELECT fn_set_categoria_activa(%s, %s, false)', :admin, :cat_perf), 'no se puede desactivar');

-- Productos
SELECT pg_temp.espera_error(format('SELECT fn_guardar_producto(%s, NULL, %s, %L)', :maria, :cat_rel, 'Reloj'), 'PRODUCTOS_GESTIONAR');
SELECT pg_temp.espera_error(format('SELECT fn_guardar_producto(%s, NULL, 999999, %L)', :admin, 'Reloj'), 'La categoría 999999 no existe');
SELECT fn_guardar_producto(:admin, NULL, :cat_rel, ' Reloj clásico ', 'Correa de cuero') AS prod_rel \gset
SELECT pg_temp.afirma((SELECT nombre = 'Reloj clásico' AND descripcion = 'Correa de cuero' AND tipo = 'PRODUCTO' AND activo FROM producto WHERE id = :prod_rel), 'producto nuevo: siempre de tipo PRODUCTO');
SELECT fn_set_categoria_activa(:admin, :cat_rel, false);
SELECT pg_temp.espera_error(format('SELECT fn_guardar_producto(%s, NULL, %s, %L)', :admin, :cat_rel, 'Otro reloj'), 'está inactiva');
SELECT fn_guardar_producto(:admin, :prod_rel, :cat_rel, 'Reloj clásico dama');
SELECT pg_temp.afirma((SELECT nombre = 'Reloj clásico dama' AND descripcion IS NULL FROM producto WHERE id = :prod_rel), 'el producto se puede editar aunque su categoría esté inactiva');
SELECT fn_set_categoria_activa(:admin, :cat_rel, true);
SELECT pg_temp.espera_error(format('SELECT fn_guardar_producto(%s, 999999, %s, %L)', :admin, :cat_rel, 'Nada'), 'El producto 999999 no existe');
-- las perforaciones no se editan como productos
SELECT producto_id AS prod_srv FROM variante WHERE id = :lob \gset
SELECT pg_temp.espera_error(format('SELECT fn_guardar_producto(%s, %s, %s, %L)', :admin, :prod_srv, :cat_rel, 'Otra cosa'), 'pantalla de perforaciones');
SELECT pg_temp.espera_error(format('SELECT fn_set_producto_activo(%s, %s, false)', :admin, :prod_srv), 'pantalla de perforaciones');
SELECT pg_temp.espera_error(format('SELECT fn_crear_variante(%s, %s, %L, 100)', :admin, :prod_srv, 'SRV-X'), 'las crea el sistema');
SELECT pg_temp.espera_error(format('SELECT fn_actualizar_variante(%s, %s, %L, %L)', :admin, :lob, 'SRV-LOB', 'Otro'), 'no se editan a mano');
SELECT pg_temp.espera_error(format('SELECT fn_set_variante_activa(%s, %s, false)', :admin, :lob), 'pantalla de perforaciones');

-- Variantes
SELECT pg_temp.espera_error(format('SELECT fn_crear_variante(%s, %s, %L, 900)', :maria, :prod_rel, 'REL-01'), 'PRODUCTOS_GESTIONAR');
SELECT fn_crear_variante(:admin, :prod_rel, ' rel-cla-01 ', 900) AS var_rel \gset
SELECT pg_temp.afirma((SELECT sku = 'REL-CLA-01' AND nombre = 'Única' AND precio_venta = 900 AND costo = 0 AND gama_id IS NULL AND atributos = '{}'::jsonb AND activo
                         FROM variante WHERE id = :var_rel), 'variante mínima: SKU en mayúsculas, nombre "Única", costo 0');
SELECT fn_crear_variante(:admin, :prod_rel, 'REL-CLA-02', 1100, 'Dorado', 400, ' 7509990000011 ', NULL, '{"color":"dorado"}', 'https://ejemplo.com/reloj.jpg') AS var_rel2 \gset
SELECT pg_temp.afirma((SELECT nombre = 'Dorado' AND costo = 400 AND codigo_barras = '7509990000011' AND atributos->>'color' = 'dorado' AND foto_url = 'https://ejemplo.com/reloj.jpg'
                         FROM variante WHERE id = :var_rel2), 'variante completa: costo, código de barras, atributos y foto');
SELECT pg_temp.espera_error(format('SELECT fn_crear_variante(%s, %s, %L, 900)', :admin, :prod_rel, 'rel-cla-01'), 'duplicate key');
SELECT pg_temp.espera_error(format('SELECT fn_crear_variante(%s, %s, %L, 900, NULL, 0, %L)', :admin, :prod_rel, 'REL-CLA-03', '7509990000011'), 'duplicate key');
SELECT pg_temp.espera_error(format('SELECT fn_crear_variante(%s, %s, %L, -1)', :admin, :prod_rel, 'REL-CLA-03'), 'check');
SELECT pg_temp.espera_error(format('SELECT fn_crear_variante(%s, 999999, %L, 900)', :admin, 'REL-CLA-03'), 'El producto 999999 no existe');
SELECT pg_temp.espera_error(format('SELECT fn_crear_variante(%s, %s, %L, 900, NULL, 0, NULL, 999999)', :admin, :prod_rel, 'REL-CLA-03'), 'La gama 999999 no existe');
SELECT pg_temp.espera_error(format('SELECT fn_actualizar_variante(%s, 999999, %L, %L)', :admin, 'X', 'X'), 'La variante 999999 no existe');

-- Con PRODUCTOS_GESTIONAR pero sin PRECIOS_EDITAR: se edita el catálogo, no los precios
SELECT fn_set_permisos_rol(:admin, 'ENCARGADO', :'perm_enc'::text[] || ARRAY['PRODUCTOS_GESTIONAR']);
SELECT pg_temp.espera_error(format('SELECT fn_crear_variante(%s, %s, %L, 900)', :maria, :prod_rel, 'REL-CLA-03'), 'PRECIOS_EDITAR');
SELECT pg_temp.espera_error(format('SELECT fn_set_precio_variante(%s, %s, 950)', :maria, :var_rel), 'PRECIOS_EDITAR');
SELECT fn_actualizar_variante(:maria, :var_rel, 'rel-cla-01', 'Plateado', NULL, NULL, '{"color":"plateado"}');
SELECT pg_temp.afirma((SELECT nombre = 'Plateado' AND sku = 'REL-CLA-01' AND precio_venta = 900 AND atributos->>'color' = 'plateado' FROM variante WHERE id = :var_rel), 'editar la variante no toca su precio');
SELECT fn_set_permisos_rol(:admin, 'ENCARGADO', :'perm_enc'::text[]);

-- Precio y costo
SELECT count(*) AS hist_antes FROM historial_precio WHERE variante_id = :var_rel \gset
SELECT fn_set_precio_variante(:admin, :var_rel, 950);
SELECT pg_temp.afirma((SELECT precio_venta = 950 AND costo = 0 FROM variante WHERE id = :var_rel), 'cambiar solo el precio deja el costo igual');
SELECT fn_set_precio_variante(:admin, :var_rel, NULL, 380);
SELECT pg_temp.afirma((SELECT precio_venta = 950 AND costo = 380 FROM variante WHERE id = :var_rel), 'cambiar solo el costo deja el precio igual');
SELECT pg_temp.afirma((SELECT count(*) FROM historial_precio WHERE variante_id = :var_rel) = :hist_antes + 2
                  AND (SELECT usuario_id = :admin AND precio_anterior = 950 AND precio_nuevo = 950 AND costo_anterior = 0 AND costo_nuevo = 380
                         FROM historial_precio WHERE variante_id = :var_rel ORDER BY id DESC LIMIT 1),
                      'cada cambio de precio o de costo queda en el historial con quién lo hizo');
SELECT pg_temp.espera_error(format('SELECT fn_set_precio_variante(%s, %s, -5)', :admin, :var_rel), 'check');
SELECT pg_temp.espera_error(format('SELECT fn_set_precio_variante(%s, 999999, 5)', :admin), 'La variante 999999 no existe');
SELECT pg_temp.espera_error(format('SELECT fn_set_precio_variante(%s, (SELECT paquete_variante_id FROM perforacion WHERE id = %s), 500)', :admin, :p_hlx), 'se calcula con la pieza');
SELECT pg_temp.espera_error(format('SELECT fn_set_precio_variante(%s, %s, 300, 50)', :admin, :lob), 'llevan costo');
SELECT fn_set_precio_variante(:admin, :lob, 320);
SELECT pg_temp.afirma((SELECT precio = 320 + 650 FROM fn_precio_paquete(:p_lob, ARRAY[:lab6]::bigint[])), 'el precio de "solo servicio" de una perforación se cambia igual');
SELECT fn_set_precio_variante(:admin, :lob, 300);

-- Desactivar: no mientras haya existencias
SELECT pg_temp.espera_error(format('SELECT fn_set_variante_activa(%s, %s, false)', :admin, :lab6), 'no se puede desactivar');
SELECT pg_temp.espera_error(format('SELECT fn_set_producto_activo(%s, (SELECT producto_id FROM variante WHERE id = %s), false)', :admin, :lab6), 'no se puede desactivar');
SELECT fn_set_variante_activa(:admin, :var_rel2, false);
SELECT pg_temp.afirma(NOT EXISTS (SELECT 1 FROM fn_buscar_variantes('REL-CLA-02', :lam)) AND EXISTS (SELECT 1 FROM fn_buscar_variantes('REL-CLA-01', :lam)),
                      'la variante desactivada sale de la búsqueda del POS');
SELECT fn_set_producto_activo(:admin, :prod_rel, false);
SELECT pg_temp.afirma(NOT EXISTS (SELECT 1 FROM fn_buscar_variantes('REL-CLA-01', :lam)), 'el producto desactivado (sin existencias) sale de la búsqueda del POS');
SELECT fn_set_producto_activo(:admin, :prod_rel, true);
SELECT fn_set_variante_activa(:admin, :var_rel2, true);
SELECT fn_movimiento_inventario(:admin, :bod, :var_rel, 'ENTRADA', 3, 'Inventario inicial de relojes', 380);
SELECT pg_temp.espera_error(format('SELECT fn_set_variante_activa(%s, %s, false)', :admin, :var_rel), 'todavía tiene 3 unidad(es)');
SELECT pg_temp.espera_error(format('SELECT fn_set_producto_activo(%s, %s, false)', :admin, :prod_rel), 'todavía tiene 3 unidad(es)');

-- Gamas
SELECT pg_temp.espera_error(format('SELECT fn_guardar_gama(%s, NULL, %L, %L)', :maria, 'Oro 14k', 'PIEZA'), 'PRODUCTOS_GESTIONAR');
SELECT fn_guardar_gama(:admin, NULL, ' Oro 14k ', 'pieza', 4) AS g_oro \gset
SELECT pg_temp.afirma((SELECT nombre = 'Oro 14k' AND modo_precio = 'PIEZA' AND orden = 4 AND activa FROM gama WHERE id = :g_oro), 'gama nueva');
SELECT fn_guardar_gama(:admin, :g_oro, 'Oro 14 k', 'TABLA', 5);
SELECT pg_temp.afirma((SELECT nombre = 'Oro 14 k' AND modo_precio = 'TABLA' AND orden = 5 FROM gama WHERE id = :g_oro), 'una gama sin uso puede cambiar de modo de precio');
SELECT pg_temp.espera_error(format('SELECT fn_guardar_gama(%s, %s, %L, %L)', :admin, :g_cla, 'Acero clásica', 'PIEZA'), 'no se puede cambiar su modo de precio');
SELECT fn_guardar_gama(:admin, :g_cla, 'Acero clásica', 'TABLA', 1);
SELECT pg_temp.espera_error(format('SELECT fn_guardar_gama(%s, 999999, %L, %L)', :admin, 'Nada', 'TABLA'), 'La gama 999999 no existe');
SELECT pg_temp.espera_error(format('SELECT fn_guardar_gama(%s, NULL, %L, %L)', :admin, 'Rara', 'OTRO'), 'check');
SELECT pg_temp.espera_error(format('SELECT fn_guardar_gama(%s, NULL, %L, %L)', :admin, 'Titanio', 'PIEZA'), 'duplicate key');
SELECT fn_set_gama_activa(:admin, :g_oro, false);
SELECT pg_temp.espera_error(format('SELECT fn_actualizar_variante(%s, %s, %L, %L, NULL, %s)', :admin, :var_rel, 'REL-CLA-01', 'Plateado', :g_oro), 'está inactiva');
SELECT pg_temp.afirma(NOT EXISTS (SELECT 1 FROM v_precios_perforacion WHERE gama_id = :g_oro), 'la gama inactiva no aparece en la tabla de precios');
SELECT fn_set_gama_activa(:admin, :g_oro, true);
SELECT fn_actualizar_variante(:admin, :var_rel, 'REL-CLA-01', 'Plateado', NULL, :g_oro);
SELECT pg_temp.afirma((SELECT gama_id = :g_oro FROM variante WHERE id = :var_rel)
                  AND (SELECT count(*) FROM v_precios_perforacion WHERE gama_id = :g_oro AND precio_paquete IS NULL) = (SELECT count(*) FROM perforacion),
                      'la pieza queda en la gama nueva, que aparece en la tabla de precios sin precio todavía');
SELECT pg_temp.espera_error(format('SELECT fn_set_gama_activa(%s, 999999, false)', :admin), 'La gama 999999 no existe');

-- Perforaciones: editar y desactivar
SELECT pg_temp.espera_error(format('SELECT fn_actualizar_perforacion(%s, %s, %L, 1)', :maria, :p_trg, 'Trago'), 'PRODUCTOS_GESTIONAR');
SELECT fn_actualizar_perforacion(:admin, :p_trg, ' Tragus doble ', 2);
SELECT pg_temp.afirma((SELECT nombre = 'Tragus doble' AND piezas_por_paquete = 2 AND codigo = 'TRG' FROM perforacion WHERE id = :p_trg)
                  AND (SELECT count(*) FROM producto WHERE nombre IN ('Perforación Tragus doble', 'Perforación Tragus doble con pieza')) = 2,
                      'renombrar la perforación renombra sus dos entradas del catálogo');
SELECT pg_temp.afirma((SELECT precio = 400 + 650 + 650 FROM fn_precio_paquete(:p_trg, ARRAY[:lab6, :lab8]::bigint[])), 'el paquete pasa a llevar 2 piezas');
SELECT fn_actualizar_perforacion(:admin, :p_trg, 'Tragus', 1);
SELECT pg_temp.espera_error(format('SELECT fn_actualizar_perforacion(%s, 999999, %L, 1)', :admin, 'Nada'), 'La perforación 999999 no existe');
SELECT pg_temp.espera_error(format('SELECT fn_actualizar_perforacion(%s, %s, %L, 9)', :admin, :p_trg, 'Tragus'), 'check');
SELECT fn_set_perforacion_activa(:admin, :p_trg, false);
SELECT pg_temp.afirma(NOT EXISTS (SELECT 1 FROM fn_buscar_variantes('tragus', :lam)), 'la perforación desactivada sale de la búsqueda del POS (servicio y paquete)');
SELECT pg_temp.espera_error(format('SELECT * FROM fn_precio_paquete(%s, ARRAY[%s]::bigint[])', :p_trg, :lab6), 'no existe o está inactiva');
SELECT fn_set_perforacion_activa(:admin, :p_trg, true);
SELECT pg_temp.afirma((SELECT count(*) FROM fn_buscar_variantes('tragus', :lam)) = 2, 'al reactivarla vuelven sus dos entradas');
SELECT pg_temp.espera_error(format('SELECT fn_set_perforacion_activa(%s, 999999, false)', :admin), 'La perforación 999999 no existe');

-- Promociones: estado de cada una para la pantalla del admin
SELECT fn_guardar_promocion(:admin, NULL, 'Vencida B4', 'MONTO', 50, 0, current_date - 20, current_date - 10) AS promo_venc \gset
SELECT fn_set_promocion_activa(:admin, :promo_venc, true);
SELECT fn_guardar_promocion(:admin, NULL, 'Programada B4', 'MONTO', 50, 0, current_date + 10, current_date + 20) AS promo_prog \gset
SELECT fn_set_promocion_activa(:admin, :promo_prog, true);
SELECT pg_temp.afirma((SELECT estado FROM v_promociones_admin WHERE id = :promo_venc) = 'VENCIDA'
                  AND (SELECT estado FROM v_promociones_admin WHERE id = :promo_prog) = 'PROGRAMADA'
                  AND (SELECT estado = 'VIGENTE' AND ventas = 1 FROM v_promociones_admin WHERE id = :promo40)
                  AND (SELECT estado FROM v_promociones_admin WHERE nombre = 'Black Friday 20 %') = 'INACTIVA',
                      'la pantalla de promociones muestra el estado de cada una y cuántas ventas la usaron');
SELECT pg_temp.afirma(NOT EXISTS (SELECT 1 FROM fn_promociones_disponibles() d JOIN v_promociones_admin p ON p.id = d.promocion_id WHERE p.estado <> 'VIGENTE')
                  AND (SELECT count(*) FROM fn_promociones_disponibles()) = (SELECT count(*) FROM v_promociones_admin WHERE estado = 'VIGENTE'),
                      'VIGENTE coincide con lo que ofrece el POS');

\echo '\n=== 20. PENDIENTES DEL PANEL: PARÁMETROS CON MÍNIMO, SUCURSALES, CAJAS, ROLES, DESBLOQUEO Y FOTOS'
SELECT set_config('app.usuario_id', :'admin', false);

-- Parámetros con mínimo: una sesión de 0 horas se cerraría sola al instante
SELECT pg_temp.espera_error(format('SELECT fn_set_parametro(%s, %L, %L)', :admin, 'SESION_HORAS_EQUIPO', '0'), 'no puede ser menor que 1');
SELECT pg_temp.espera_error(format('SELECT fn_set_parametro(%s, %L, %L)', :admin, 'SESION_DIAS_SIN_EQUIPO', '0.5'), 'no puede ser menor que 1');
SELECT fn_set_parametro(:admin, 'SESION_HORAS_EQUIPO', '1');
SELECT fn_set_parametro(:admin, 'CAJA_TOLERANCIA_DIFERENCIA_NIO', '0');
SELECT pg_temp.afirma(fn_parametro_num('SESION_HORAS_EQUIPO') = 1 AND fn_parametro_num('CAJA_TOLERANCIA_DIFERENCIA_NIO') = 0,
                      'el mínimo se acepta, y los parámetros sin mínimo siguen aceptando 0');
SELECT fn_set_parametro(:admin, 'SESION_HORAS_EQUIPO', '12');
SELECT fn_set_parametro(:admin, 'CAJA_TOLERANCIA_DIFERENCIA_NIO', '100');
SELECT pg_temp.espera_error($q$UPDATE parametro SET minimo = 1 WHERE clave = 'CAJA_HORA_ALERTA_CIERRE'$q$, 'ck_parametro_minimo');

-- Sucursales
SELECT pg_temp.espera_error(format('SELECT fn_guardar_sucursal(%s, NULL, %L, %L)', :maria, 'MET', 'Metrocentro'), 'SUCURSALES_GESTIONAR');
SELECT fn_guardar_sucursal(:admin, NULL, ' met ', ' Metrocentro ', 'Metrocentro, Managua', '2222-0000') AS suc_met \gset
SELECT pg_temp.afirma((SELECT codigo = 'MET' AND nombre = 'Metrocentro' AND tipo = 'SUCURSAL' AND telefono = '2222-0000' AND activa FROM sucursal WHERE id = :suc_met),
                      'sucursal nueva: siempre de venta, con el código en mayúsculas');
SELECT pg_temp.espera_error(format('SELECT fn_guardar_sucursal(%s, NULL, %L, %L)', :admin, 'MET', 'Otra'), 'duplicate key');
SELECT pg_temp.espera_error(format('SELECT fn_guardar_sucursal(%s, NULL, %L, %L)', :admin, 'M1', 'Otra'), 'check');
SELECT pg_temp.espera_error(format('SELECT fn_guardar_sucursal(%s, 999999, %L, %L)', :admin, 'XXX', 'Nada'), 'La sucursal 999999 no existe');
SELECT fn_guardar_sucursal(:admin, :suc_met, 'MTC', 'Metrocentro Managua');
SELECT pg_temp.afirma((SELECT codigo = 'MTC' AND nombre = 'Metrocentro Managua' AND direccion IS NULL FROM sucursal WHERE id = :suc_met), 'sin ventas, la sucursal puede cambiar de código');
SELECT pg_temp.espera_error(format('SELECT fn_guardar_sucursal(%s, %s, %L, %L)', :admin, :lam, 'AME', 'Multicentro Las Américas'), 'no se puede cambiar');
SELECT fn_guardar_sucursal(:admin, :lam, 'LAM', 'Multicentro Las Américas', 'Multicentro Las Américas, Managua', '2277-0000');
SELECT pg_temp.afirma((SELECT telefono = '2277-0000' FROM sucursal WHERE id = :lam), 'con ventas, la sucursal se edita si conserva su código');
SELECT fn_guardar_sucursal(:admin, :bod, 'BOD', 'Bodega central', 'Casa del dueño');
SELECT pg_temp.afirma((SELECT tipo = 'BODEGA' AND direccion = 'Casa del dueño' FROM sucursal WHERE id = :bod), 'la bodega se puede editar y sigue siendo la bodega');

-- Cajas
SELECT pg_temp.espera_error(format('SELECT fn_crear_caja(%s, %s, %L)', :maria, :suc_met, 'Caja 1'), 'SUCURSALES_GESTIONAR');
SELECT fn_crear_caja(:admin, :suc_met, ' Caja 1 ') AS caja_met \gset
SELECT pg_temp.espera_error(format('SELECT fn_crear_caja(%s, %s, %L)', :admin, :suc_met, 'Caja 1'), 'duplicate key');
SELECT pg_temp.espera_error(format('SELECT fn_crear_caja(%s, %s, %L)', :admin, :bod, 'Caja bodega'), 'la bodega no vende');
SELECT pg_temp.espera_error(format('SELECT fn_crear_caja(%s, 999999, %L)', :admin, 'Caja'), 'La sucursal 999999 no existe');
SELECT fn_renombrar_caja(:admin, :caja_met, 'Caja principal');
SELECT pg_temp.afirma((SELECT nombre = 'Caja principal' AND activa FROM caja WHERE id = :caja_met), 'caja creada y renombrada');
SELECT pg_temp.espera_error(format('SELECT fn_renombrar_caja(%s, 999999, %L)', :admin, 'Nada'), 'La caja 999999 no existe');

-- Desactivar una caja o una sucursal: no con un turno abierto, envíos en tránsito o existencias
SELECT fn_abrir_turno(:admin, :caja_met, 0, 0) AS turno_met \gset
SELECT pg_temp.espera_error(format('SELECT fn_set_caja_activa(%s, %s, false)', :admin, :caja_met), 'tiene un turno abierto');
SELECT pg_temp.espera_error(format('SELECT fn_set_sucursal_activa(%s, %s, false)', :admin, :suc_met), 'tiene un turno de caja abierto');
SELECT fn_cierre_forzado(:admin, :turno_met, 'Prueba de desactivación de la sucursal');
SELECT fn_crear_envio(:admin, :bod, :suc_met, 'Prueba') AS env_met \gset
SELECT fn_envio_set_linea(:admin, :env_met, :lab6, 1);
SELECT fn_enviar(:admin, :env_met);
SELECT pg_temp.espera_error(format('SELECT fn_set_sucursal_activa(%s, %s, false)', :admin, :suc_met), 'tiene envíos en tránsito');
SELECT * FROM fn_recibir_envio(:admin, :env_met, format('[{"variante_id":%s,"cantidad":1}]', :lab6)::jsonb);
SELECT pg_temp.espera_error(format('SELECT fn_set_sucursal_activa(%s, %s, false)', :admin, :suc_met), 'todavía tiene 1 unidad(es) en existencia');
SELECT fn_crear_envio(:admin, :suc_met, :bod, 'Devolución') AS env_met2 \gset
SELECT fn_envio_set_linea(:admin, :env_met2, :lab6, 1);
SELECT fn_enviar(:admin, :env_met2);
SELECT * FROM fn_recibir_envio(:admin, :env_met2, format('[{"variante_id":%s,"cantidad":1}]', :lab6)::jsonb);
SELECT pg_temp.espera_error(format('SELECT fn_set_sucursal_activa(%s, %s, false)', :maria, :suc_met), 'SUCURSALES_GESTIONAR');
SELECT fn_set_sucursal_activa(:admin, :suc_met, false);
SELECT pg_temp.afirma((SELECT NOT activa FROM sucursal WHERE id = :suc_met), 'sucursal vacía desactivada');
SELECT pg_temp.espera_error(format('SELECT fn_abrir_turno(%s, %s, 0, 0)', :admin, :caja_met), 'está inactiva');
SELECT pg_temp.espera_error(format('SELECT fn_crear_envio(%s, %s, %s)', :admin, :bod, :suc_met), 'inexistente o inactivo');
SELECT pg_temp.afirma(NOT EXISTS (SELECT 1 FROM fn_consultar_stock(:admin, :lab6) WHERE sucursal_id = :suc_met), 'la sucursal inactiva sale de la consulta de existencias');
SELECT fn_set_sucursal_activa(:admin, :suc_met, true);
SELECT fn_set_caja_activa(:admin, :caja_met, false);
SELECT pg_temp.espera_error(format('SELECT fn_abrir_turno(%s, %s, 0, 0)', :admin, :caja_met), 'no existe o está inactiva');
SELECT fn_set_caja_activa(:admin, :caja_met, true);
SELECT pg_temp.espera_error(format('SELECT fn_set_sucursal_activa(%s, %s, false)', :admin, :bod), 'La bodega central no se puede desactivar');
SELECT pg_temp.espera_error(format('SELECT fn_set_sucursal_activa(%s, %s, false)', :admin, :lam), 'todavía tiene');
SELECT pg_temp.espera_error(format('SELECT fn_set_sucursal_activa(%s, 999999, false)', :admin), 'La sucursal 999999 no existe');
SELECT pg_temp.espera_error(format('SELECT fn_set_caja_activa(%s, 999999, false)', :admin), 'La caja 999999 no existe');

-- Roles nuevos
SELECT pg_temp.espera_error(format('SELECT fn_crear_rol(%s, %L, %L)', :maria, 'SUPERVISOR', 'Supervisor'), 'ROLES_GESTIONAR');
SELECT fn_crear_rol(:admin, ' supervisor ', ' Supervisor ', 'Revisa cajas') AS rol_sup \gset
SELECT pg_temp.afirma((SELECT codigo = 'SUPERVISOR' AND nombre = 'Supervisor' AND NOT es_sistema AND editable AND permisos = '{}'::text[] AND usuarios = 0
                         FROM v_roles_admin WHERE id = :rol_sup), 'rol nuevo: sin permisos y no es de sistema');
SELECT pg_temp.espera_error(format('SELECT fn_crear_rol(%s, %L, %L)', :admin, 'SUPERVISOR', 'Otro'), 'duplicate key');
SELECT pg_temp.espera_error(format('SELECT fn_crear_rol(%s, %L, %L)', :admin, 'jefe 1', 'Otro'), 'check');
SELECT fn_set_permisos_rol(:admin, 'SUPERVISOR', ARRAY['CAJA_VER_DIFERENCIAS', 'REPORTES_VER']);
SELECT fn_actualizar_rol(:admin, 'supervisor', 'Supervisora', '');
SELECT pg_temp.afirma((SELECT nombre = 'Supervisora' AND descripcion IS NULL AND cardinality(permisos) = 2 FROM v_roles_admin WHERE id = :rol_sup),
                      'rol editado: cambia nombre y descripción, conserva sus permisos');
SELECT pg_temp.espera_error(format('SELECT fn_actualizar_rol(%s, %L, %L)', :admin, 'GERENTE', 'Gerente'), 'Rol inexistente');
SELECT fn_actualizar_usuario(:admin, :carlos, 'Carlos Ruiz', 'SUPERVISOR', ARRAY[:lbr]);
SELECT pg_temp.afirma(fn_tiene_permiso(:carlos, 'REPORTES_VER') AND NOT fn_tiene_permiso(:carlos, 'VENTAS_REGISTRAR')
                  AND (SELECT usuarios = 1 AND usuarios_activos = 1 FROM v_roles_admin WHERE id = :rol_sup), 'el usuario toma los permisos de su rol nuevo');
SELECT pg_temp.espera_error(format('SELECT fn_eliminar_rol(%s, %L)', :admin, 'SUPERVISOR'), 'tiene 1 usuario(s)');
SELECT fn_actualizar_usuario(:admin, :carlos, 'Carlos Ruiz', 'VENDEDOR', ARRAY[:lbr]);
SELECT pg_temp.espera_error(format('SELECT fn_eliminar_rol(%s, %L)', :admin, 'VENDEDOR'), 'es de sistema');
SELECT pg_temp.espera_error(format('SELECT fn_eliminar_rol(%s, %L)', :maria, 'SUPERVISOR'), 'ROLES_GESTIONAR');
SELECT pg_temp.espera_error(format('SELECT fn_eliminar_rol(%s, %L)', :admin, 'GERENTE'), 'Rol inexistente');
SELECT fn_eliminar_rol(:admin, 'SUPERVISOR');
SELECT pg_temp.afirma(NOT EXISTS (SELECT 1 FROM rol WHERE codigo = 'SUPERVISOR') AND NOT EXISTS (SELECT 1 FROM rol_permiso WHERE rol_id = :rol_sup),
                      'rol eliminado junto con sus permisos');

-- Desbloquear una cuenta sin cambiarle la contraseña
SELECT fn_registrar_login('ana.martinez', false) FROM generate_series(1, 5);
SELECT pg_temp.afirma((SELECT estado FROM v_usuarios_admin WHERE id = :ana) = 'BLOQUEADO', 'cuenta bloqueada por 5 contraseñas incorrectas');
SELECT password_hash AS hash_ana FROM usuario WHERE id = :ana \gset
SELECT pg_temp.espera_error(format('SELECT fn_desbloquear_usuario(%s, %s)', :maria, :ana), 'USUARIOS_GESTIONAR');
SELECT fn_desbloquear_usuario(:admin, :ana);
SELECT pg_temp.afirma((SELECT estado = 'ACTIVO' AND intentos_fallidos = 0 AND bloqueado_hasta IS NULL FROM v_usuarios_admin WHERE id = :ana)
                  AND (SELECT password_hash = :'hash_ana' FROM usuario WHERE id = :ana), 'desbloquear no cambia la contraseña');
SELECT pg_temp.espera_error(format('SELECT fn_desbloquear_usuario(%s, 999999)', :admin), 'Usuario 999999 no existe');
SELECT fn_set_permisos_rol(:admin, 'ENCARGADO', :'perm_enc'::text[] || ARRAY['USUARIOS_GESTIONAR']);
SELECT pg_temp.espera_error(format('SELECT fn_desbloquear_usuario(%s, %s)', :maria, :admin), 'Solo un administrador puede modificar a otro administrador');
SELECT fn_set_permisos_rol(:admin, 'ENCARGADO', :'perm_enc'::text[]);

-- Foto de una variante
SELECT pg_temp.espera_error(format('SELECT fn_set_foto_variante(%s, %s, %L)', :maria, :lab6, '/api/fotos/x.jpg'), 'PRODUCTOS_GESTIONAR');
SELECT pg_temp.afirma(fn_set_foto_variante(:admin, :lab6, ' /api/fotos/labret.jpg ') IS NULL, 'primera foto: no había una anterior');
SELECT pg_temp.afirma(fn_set_foto_variante(:admin, :lab6, NULL) = '/api/fotos/labret.jpg', 'al cambiar o quitar la foto se devuelve la anterior (para borrar su archivo)');
SELECT pg_temp.afirma((SELECT foto_url IS NULL FROM variante WHERE id = :lab6), 'foto quitada');
SELECT pg_temp.espera_error(format('SELECT fn_set_foto_variante(%s, 999999, NULL)', :admin), 'La variante 999999 no existe');

\echo '\n=== 21. INVENTARIO (backend B5): PROVEEDORES, ENCABEZADO DE COMPRA, STOCK MÍNIMO Y VISIBILIDAD DE LA BODEGA'
SELECT set_config('app.usuario_id', :'admin', false);

-- Proveedores
SELECT pg_temp.espera_error(format('SELECT fn_actualizar_proveedor(%s, %s, %L)', :maria, :prov_loc, 'X'), 'INVENTARIO_ENTRADA');
SELECT fn_actualizar_proveedor(:admin, :prov_loc, ' Distribuidora Local S.A. ', 'Nicaragua', 'nio', 'Juan Pérez', '2255-0000', 'ventas@local.example');
SELECT pg_temp.afirma((SELECT nombre = 'Distribuidora Local S.A.' AND moneda_habitual = 'NIO' AND contacto = 'Juan Pérez' AND email = 'ventas@local.example' FROM proveedor WHERE id = :prov_loc), 'proveedor editado');
SELECT pg_temp.espera_error(format('SELECT fn_actualizar_proveedor(%s, 999999, %L)', :admin, 'Nadie'), 'El proveedor 999999 no existe');
SELECT pg_temp.espera_error(format('SELECT fn_actualizar_proveedor(%s, %s, %L)', :admin, :prov_loc, 'Body Jewelry Supply'), 'duplicate key');
SELECT pg_temp.espera_error(format('SELECT fn_set_proveedor_activo(%s, %s, false)', :maria, :prov_loc), 'INVENTARIO_ENTRADA');
SELECT fn_set_proveedor_activo(:admin, :prov_loc, false);
SELECT pg_temp.espera_error(format('SELECT fn_crear_compra(%s, %s, %L, current_date, %L)', :admin, :prov_loc, 'B5-1', 'NIO'), 'no existe o está inactivo');
SELECT fn_set_proveedor_activo(:admin, :prov_loc, true);
SELECT pg_temp.espera_error(format('SELECT fn_set_proveedor_activo(%s, 999999, false)', :admin), 'El proveedor 999999 no existe');

-- Encabezado de una compra en borrador
SELECT fn_crear_compra(:admin, :prov_loc, 'B5-1', current_date, 'NIO') AS compra_b5 \gset
SELECT fn_compra_set_linea(:admin, :compra_b5, :cad, 2, 500);
SELECT pg_temp.espera_error(format('SELECT fn_actualizar_compra(%s, %s, %s, %L, current_date, %L)', :maria, :compra_b5, :prov_loc, 'B5-2', 'NIO'), 'INVENTARIO_ENTRADA');
SELECT fn_actualizar_compra(:admin, :compra_b5, :prov_usa, ' B5-2 ', current_date - 1, 'usd', 36.50, 'Corregida');
SELECT pg_temp.afirma((SELECT proveedor_id = :prov_usa AND factura_numero = 'B5-2' AND fecha_factura = current_date - 1 AND moneda = 'USD' AND tipo_cambio = 36.50 AND notas = 'Corregida'
                         FROM compra WHERE id = :compra_b5) AND (SELECT count(*) FROM compra_detalle WHERE compra_id = :compra_b5) = 1,
                      'se corrige el encabezado de la compra en borrador y sus líneas se conservan');
SELECT fn_actualizar_compra(:admin, :compra_b5, :prov_usa, 'B5-2', current_date, 'USD');
SELECT pg_temp.afirma((SELECT tipo_cambio = fn_tipo_cambio_vigente(current_date) FROM compra WHERE id = :compra_b5), 'en dólares, sin tipo de cambio se usa el vigente a la fecha de la factura');
SELECT fn_actualizar_compra(:admin, :compra_b5, :prov_loc, 'B5-2', current_date, 'NIO', 36.50);
SELECT pg_temp.afirma((SELECT tipo_cambio = 1 FROM compra WHERE id = :compra_b5), 'en córdobas el tipo de cambio siempre es 1');
SELECT pg_temp.espera_error(format('SELECT fn_actualizar_compra(%s, %s, %s, %L, current_date, %L)', :admin, :compra_b5, :prov_usa, 'INV-1001', 'USD'), 'ya fue registrada');
SELECT pg_temp.espera_error(format('SELECT fn_actualizar_compra(%s, 999999, %s, %L, current_date, %L)', :admin, :prov_usa, 'X', 'USD'), 'La compra 999999 no existe');
SELECT pg_temp.espera_error(format('SELECT fn_actualizar_compra(%s, %s, 999999, %L, current_date, %L)', :admin, :compra_b5, 'X', 'USD'), 'no existe o está inactivo');
SELECT pg_temp.espera_error(format('SELECT fn_actualizar_compra(%s, %s, %s, %L, current_date, %L)', :admin, :compra1, :prov_usa, 'INV-1001', 'USD'), 'ya está confirmada');
SELECT fn_cancelar_compra(:admin, :compra_b5, 'Era una prueba');

-- Stock mínimo
SELECT pg_temp.espera_error(format('SELECT fn_set_stock_minimo(%s, %s, %s, 4)', :maria, :lam, :cad), 'INVENTARIO_AJUSTAR');
SELECT cantidad AS cad_lam FROM stock_sucursal WHERE sucursal_id = :lam AND variante_id = :cad \gset
SELECT fn_set_stock_minimo(:admin, :lam, :cad, :cad_lam + 2);
SELECT pg_temp.afirma((SELECT stock_minimo = :cad_lam + 2 AND cantidad = :cad_lam FROM stock_sucursal WHERE sucursal_id = :lam AND variante_id = :cad)
                  AND (SELECT alerta_stock_bajo FROM v_stock_actual WHERE sucursal_id = :lam AND variante_id = :cad), 'el stock mínimo no toca la cantidad y enciende la alerta de stock bajo');
SELECT fn_set_stock_minimo(:admin, :lam, :cad, 0);
SELECT fn_set_stock_minimo(:admin, :lbr, :var_rel, 3);
SELECT pg_temp.afirma((SELECT cantidad = 0 AND stock_minimo = 3 FROM stock_sucursal WHERE sucursal_id = :lbr AND variante_id = :var_rel), 'se puede fijar el mínimo de una pieza que todavía no ha llegado a la sucursal');
SELECT pg_temp.afirma((SELECT sugerido FROM fn_sugerir_reparto(:var_rel, 3) WHERE sucursal_id = :lbr) = 3, 'la sugerencia de reparto cubre primero ese mínimo');
SELECT pg_temp.espera_error(format('SELECT fn_set_stock_minimo(%s, %s, %s, -1)', :admin, :lam, :cad), 'debe ser 0 o más');
SELECT pg_temp.espera_error(format('SELECT fn_set_stock_minimo(%s, 999999, %s, 1)', :admin, :cad), 'La sucursal 999999 no existe');
SELECT pg_temp.espera_error(format('SELECT fn_set_stock_minimo(%s, %s, %s, 1)', :admin, :lam, :lob), 'Solo las piezas y artículos con stock');
SELECT pg_temp.espera_error(format('SELECT fn_set_stock_minimo(%s, %s, 999999, 1)', :admin, :lam), 'Solo las piezas y artículos con stock');

-- Visibilidad de la bodega (misma regla para la consulta de una pieza y para los listados)
SELECT pg_temp.afirma(fn_ve_cantidad_bodega(:admin) AND NOT fn_ve_cantidad_bodega(:ana), 'el admin ve la cantidad de la bodega; la vendedora, solo si hay o no');
SELECT fn_set_parametro(:admin, 'BODEGA_VISIBILIDAD', 'CANTIDAD');
SELECT pg_temp.afirma(fn_ve_cantidad_bodega(:ana), 'con BODEGA_VISIBILIDAD = CANTIDAD la vendedora también la ve');
SELECT fn_set_parametro(:admin, 'BODEGA_VISIBILIDAD', 'SI_NO');
SELECT pg_temp.afirma((SELECT cantidad IS NULL AND disponible FROM fn_consultar_stock(:ana, :lab6) WHERE tipo = 'BODEGA'), 'fn_consultar_stock sigue aplicando la regla');

\echo '\n=== 22. POS Y CAJA (backend B6): CAJA Y TURNO DE LA SESIÓN, TICKET DE CIERRE Y TIPO DE CAMBIO'
SELECT set_config('app.usuario_id', :'admin', false);
SELECT fn_guardar_sucursal(:admin, NULL, 'pos', 'Sucursal POS') AS pos \gset
SELECT fn_crear_caja(:admin, :pos, 'Caja 1') AS caja_pos1 \gset
SELECT fn_crear_usuario(:admin, 'Paula Pos', 'paula.pos', 'hash-de-prueba', 'VENDEDOR', ARRAY[:pos]) AS paula \gset
SELECT fn_registrar_dispositivo(:admin, 'PC Caja 1 POS', 'CAJA', :pos, encode(sha256('pos-pc-1'), 'hex'), :caja_pos1) AS pc_pos \gset
SELECT fn_registrar_dispositivo(:admin, 'Tablet POS', 'TABLET', :pos, encode(sha256('pos-tablet'), 'hex')) AS tab_pos \gset

-- La caja no la manda la pantalla: sale del equipo registrado
SELECT pg_temp.afirma(fn_caja_de_sesion(:paula, :'pc_pos') = :caja_pos1 AND fn_caja_de_sesion(:paula, :'pc_pos', NULL, true) = :caja_pos1, 'PC de caja: su caja, para vender y para abrir');
SELECT pg_temp.afirma(fn_caja_de_sesion(:paula, :'tab_pos', NULL, true) = :caja_pos1, 'tablet: abre la única caja de su sucursal');
SELECT pg_temp.afirma(fn_caja_de_sesion(:paula, :'tab_pos') IS NULL AND fn_turno_de_sesion(:paula, :'tab_pos') IS NULL, 'tablet sin turno abierto en la sucursal: no hay caja ni turno');
SELECT pg_temp.espera_error(format('SELECT fn_caja_de_sesion(%s, %L, %s)', :paula, :'tab_pos', :caja_pos1), 'Solo el administrador puede elegir la caja');
SELECT pg_temp.espera_error(format('SELECT fn_caja_de_sesion(%s, %L, %s)', :paula, :'pc_pos', :caja_lam), 'no se puede elegir otra');
SELECT pg_temp.espera_error(format('SELECT fn_caja_de_sesion(%s, NULL)', :paula), 'equipo registrado y activo');
SELECT pg_temp.espera_error(format('SELECT fn_caja_de_sesion(%s, %L)', :ana, :'pc_pos'), 'equipo registrado y activo');
-- El administrador: sin caja en su equipo tiene que indicarla; en una PC de caja usa la del equipo
SELECT pg_temp.espera_error(format('SELECT fn_caja_de_sesion(%s, NULL)', :admin), 'Indique la caja');
SELECT pg_temp.espera_error(format('SELECT fn_caja_de_sesion(%s, NULL, 999999)', :admin), 'La caja 999999 no existe');
SELECT pg_temp.afirma(fn_caja_de_sesion(:admin, NULL, :caja_pos1) = :caja_pos1 AND fn_caja_de_sesion(:admin, :'tab_pos', :caja_lam) = :caja_lam, 'el admin, sin caja en su equipo, elige la caja');
SELECT pg_temp.afirma(fn_caja_de_sesion(:admin, :'pc_pos') = :caja_pos1, 'el admin en una PC de caja usa la caja de ese equipo');

-- El turno: el abierto de esa caja
SELECT fn_abrir_turno(:paula, fn_caja_de_sesion(:paula, :'tab_pos', NULL, true), 500, 0) AS turno_pos \gset
SELECT pg_temp.afirma(fn_turno_de_sesion(:paula, :'pc_pos') = :turno_pos AND fn_turno_de_sesion(:paula, :'tab_pos') = :turno_pos
                  AND fn_turno_de_sesion(:admin, NULL, :caja_pos1) = :turno_pos, 'la PC, la tablet y el admin llegan al mismo turno abierto');
SELECT fn_set_dispositivo_activo(:admin, :'tab_pos', false);
SELECT pg_temp.espera_error(format('SELECT fn_turno_de_sesion(%s, %L)', :paula, :'tab_pos'), 'equipo registrado y activo');
SELECT fn_set_dispositivo_activo(:admin, :'tab_pos', true);
-- Con dos cajas en la sucursal, la tablet no decide: se trabaja desde la PC de la caja
SELECT fn_crear_caja(:admin, :pos, 'Caja 2') AS caja_pos2 \gset
SELECT pg_temp.espera_error(format('SELECT fn_caja_de_sesion(%s, %L, NULL, true)', :paula, :'tab_pos'), 'más de una caja: abra el turno desde la PC');
SELECT pg_temp.afirma(fn_turno_de_sesion(:paula, :'tab_pos') = :turno_pos, 'con una sola caja abierta la tablet sigue vendiendo en ella');
SELECT fn_abrir_turno(:admin, :caja_pos2, 0, 0) AS turno_pos2 \gset
SELECT pg_temp.espera_error(format('SELECT fn_turno_de_sesion(%s, %L)', :paula, :'tab_pos'), 'más de una caja abierta');
SELECT pg_temp.afirma(fn_turno_de_sesion(:paula, :'pc_pos') = :turno_pos, 'la PC de caja sigue con la suya');
SELECT fn_cerrar_turno(:admin, :turno_pos2, '[]') AS ticket_vacio \gset
SELECT pg_temp.afirma((:'ticket_vacio'::jsonb->>'cerrado')::boolean AND fn_turno_de_sesion(:paula, :'tab_pos') = :turno_pos, 'cerrada la segunda caja, la tablet vuelve a tener un solo turno');

-- Ticket de cierre: quien cierra recibe solo lo que contó, lo que retiró y el fondo
SELECT precio_venta AS aro_precio FROM variante WHERE id = :aro \gset
SELECT fn_movimiento_inventario(:admin, :pos, :aro, 'AJUSTE_POSITIVO', 5, 'Existencias para las pruebas del POS');
SELECT fn_registrar_venta(:paula, fn_turno_de_sesion(:paula, :'pc_pos'), format('[{"variante_id":%s,"cantidad":1}]', :aro)::jsonb,
  format('[{"metodo":"EFECTIVO","monto":%s}]', :aro_precio)::jsonb) AS v_pos \gset
SELECT pg_temp.afirma((SELECT numero = 'POS-00000001' AND turno_id = :turno_pos FROM venta WHERE id = :v_pos), 'la venta entra al turno de la caja del equipo, con el correlativo de su sucursal');
SELECT fn_cerrar_turno(:paula, :turno_pos, format('[{"moneda":"NIO","valor":1,"cantidad":%s}]', floor(500 + :aro_precio))::jsonb, '[]', floor(:aro_precio)) AS ticket_pos \gset
SELECT pg_temp.afirma(jsonb_array_length(:'ticket_pos'::jsonb->'contado') = 1 AND (:'ticket_pos'::jsonb->'contado'->0->>'monto')::numeric = floor(500 + :aro_precio)
                  AND (:'ticket_pos'::jsonb->>'retiro_nio')::numeric = floor(:aro_precio) AND (:'ticket_pos'::jsonb->>'fondo_siguiente_nio')::numeric = 500,
                  'ticket de quien cierra: lo que contó, lo que retiró y el fondo que dejó');
SELECT pg_temp.afirma(NOT (:'ticket_pos'::jsonb ?| ARRAY['ventas','anuladas','total_vendido','descuentos_promociones','cobros'])
                  AND :'ticket_pos'::jsonb::text NOT ILIKE '%esperado%' AND :'ticket_pos'::jsonb::text NOT ILIKE '%diferencia%',
                  'ese ticket no trae lo vendido ni lo cobrado por método (con eso se deduciría lo esperado)');
SELECT pg_temp.afirma(fn_ticket_cierre(:turno_pos) = :'ticket_pos'::jsonb - 'cerrado', 'reimprimirlo da el mismo ticket');
SELECT pg_temp.afirma((fn_ticket_cierre(:turno_pos, true)->>'total_vendido')::numeric = :aro_precio AND (fn_ticket_cierre(:turno_pos, true)->>'ventas')::integer = 1
                  AND jsonb_array_length(fn_ticket_cierre(:turno_pos, true)->'cobros') = 1, 'el ticket completo (CAJA_VER_DIFERENCIAS) agrega las ventas y lo cobrado');
-- Cierre forzado: no hubo conteo, se asumió lo esperado; el ticket reducido no puede traer montos
SELECT fn_abrir_turno(:paula, :caja_pos1, 500, 0) AS turno_pos3 \gset
SELECT fn_registrar_venta(:paula, :turno_pos3, format('[{"variante_id":%s,"cantidad":1}]', :aro)::jsonb, format('[{"metodo":"EFECTIVO","monto":%s}]', :aro_precio)::jsonb);
SELECT fn_cierre_forzado(:admin, :turno_pos3, 'Nadie cerró la caja de pruebas') AS ticket_forzado \gset
SELECT pg_temp.afirma(:'ticket_forzado'::jsonb ? 'cobros' AND (:'ticket_forzado'::jsonb->>'fondo_siguiente_nio')::numeric = 500 + :aro_precio, 'cierre forzado: el admin recibe el ticket completo');
SELECT pg_temp.afirma((fn_ticket_cierre(:turno_pos3)->>'cierre_forzado')::boolean
                  AND NOT (fn_ticket_cierre(:turno_pos3) ?| ARRAY['contado','retiro_nio','fondo_siguiente_nio','cobros','total_vendido']),
                  'cierre forzado: el ticket reducido no trae montos');

-- Tipo de cambio del día
SELECT fn_tipo_cambio_vigente() AS tc_antes \gset
SELECT (now() AT TIME ZONE 'America/Managua')::date AS hoy \gset
SELECT pg_temp.espera_error(format('SELECT fn_set_tipo_cambio(%s, 36.9)', :paula), 'TIPO_CAMBIO_GESTIONAR');
SELECT pg_temp.espera_error(format('SELECT fn_set_tipo_cambio(%s, 0)', :admin), 'mayor que cero');
SELECT pg_temp.espera_error(format('SELECT fn_set_tipo_cambio(%s, NULL)', :admin), 'mayor que cero');
SELECT fn_set_tipo_cambio(:maria, 36.95);
SELECT pg_temp.afirma(fn_tipo_cambio_vigente() = 36.95 AND (SELECT usuario_id = :maria FROM tipo_cambio WHERE fecha = :'hoy'), 'la encargada registra el tipo de cambio de hoy');
SELECT fn_set_tipo_cambio(:admin, 36.62435);
SELECT pg_temp.afirma(fn_tipo_cambio_vigente() = 36.6244 AND (SELECT count(*) = 1 AND bool_and(usuario_id = :admin) FROM tipo_cambio WHERE fecha = :'hoy'), 'corregirlo el mismo día reemplaza el valor (4 decimales)');
SELECT pg_temp.afirma((SELECT tipo_cambio FROM venta WHERE id = :v_pos) = :tc_antes, 'las ventas ya hechas conservan el tipo de cambio con que se cobraron');
SELECT pg_temp.afirma((SELECT count(*) FROM auditoria WHERE tabla = 'tipo_cambio' AND accion = 'UPDATE' AND usuario_id = :admin) >= 1, 'el cambio queda en la bitácora');

-- Control de variación contra el último registrado (TIPO_CAMBIO_VARIACION_MAX = 5 %); aquí el último es 36.6244
SELECT pg_temp.afirma(fn_parametro_num('TIPO_CAMBIO_VARIACION_MAX') = 5, 'la variación máxima del tipo de cambio viene en 5 %');
SELECT pg_temp.espera_error(format('SELECT fn_set_tipo_cambio(%s, 366.24)', :admin), 'se aleja más de 5 % del último registrado (36.6244)');
SELECT pg_temp.espera_error(format('SELECT fn_set_tipo_cambio(%s, 3.66, false)', :maria), 'se aleja más de 5 %');
SELECT pg_temp.espera_error(format('SELECT fn_set_tipo_cambio(%s, 40, NULL)', :admin), 'Si es correcto, confírmelo');
SELECT pg_temp.afirma(fn_tipo_cambio_vigente() = 36.6244, 'el valor rechazado no se guarda');
SELECT pg_temp.afirma(pg_temp.codigo_error(format('SELECT fn_set_tipo_cambio(%s, 40)', :admin)) = 'ESM02', 'ese rechazo lleva el código ESM02 (con él la API pide la confirmación)');
SELECT fn_set_tipo_cambio(:admin, 40, true);
SELECT pg_temp.afirma(fn_tipo_cambio_vigente() = 40, 'con la confirmación explícita se registra aunque se aleje');
SELECT fn_set_tipo_cambio(:maria, 42);
SELECT pg_temp.afirma(fn_tipo_cambio_vigente() = 42, 'una variación de justo el 5 % pasa sin confirmar');
SELECT pg_temp.espera_error(format('SELECT fn_set_tipo_cambio(%s, 44.1001)', :maria), 'se aleja más de 5 % del último registrado (42.0000)');
SELECT pg_temp.espera_error(format('SELECT fn_set_tipo_cambio(%s, 39.8999)', :maria), 'se aleja más de 5 %');
SELECT fn_set_parametro(:admin, 'TIPO_CAMBIO_VARIACION_MAX', '10');
SELECT fn_set_tipo_cambio(:maria, 38);
SELECT pg_temp.afirma(fn_tipo_cambio_vigente() = 38, 'el límite sale del parámetro: con 10 % pasa una variación del 9.5 %');
SELECT pg_temp.espera_error(format('SELECT fn_set_parametro(%s, %L, %L)', :admin, 'TIPO_CAMBIO_VARIACION_MAX', ''), 'no puede quedar vacío');
SELECT fn_set_parametro(:admin, 'TIPO_CAMBIO_VARIACION_MAX', '5');

-- Sin un tipo de cambio anterior no hay con qué comparar: solo entra entre 20 y 60
BEGIN;
DELETE FROM tipo_cambio;
SELECT pg_temp.espera_error(format('SELECT fn_set_tipo_cambio(%s, 19.9999)', :admin), 'debe estar entre 20 y 60');
SELECT pg_temp.espera_error(format('SELECT fn_set_tipo_cambio(%s, 60.0001)', :admin), 'debe estar entre 20 y 60');
SELECT pg_temp.espera_error(format('SELECT fn_set_tipo_cambio(%s, 366.24, true)', :admin), 'Es el primer tipo de cambio que se registra');
SELECT pg_temp.afirma(NOT EXISTS (SELECT 1 FROM tipo_cambio), 'fuera de ese rango no se guarda, ni con confirmación');
SELECT fn_set_tipo_cambio(:maria, 60);
SELECT pg_temp.afirma(fn_tipo_cambio_vigente() = 60, 'el primer tipo de cambio entra si está entre 20 y 60 (sin pedir confirmación)');
ROLLBACK;
SELECT pg_temp.afirma(fn_tipo_cambio_vigente() = 38, 'después de la prueba sigue el tipo de cambio que había');

SELECT fn_set_tipo_cambio(:admin, :tc_antes, true);
-- Solo deja alerta el valor que estaba fuera del límite y se guardó porque alguien lo confirmó (el 40)
SELECT pg_temp.afirma((SELECT count(*) = 1
                          AND bool_and((detalle->>'usd_a_nio')::numeric = 40 AND (detalle->>'anterior')::numeric = 36.6244
                                       AND (detalle->>'variacion_pct')::numeric = 9.22 AND (detalle->>'usuario_id')::bigint = :admin
                                       AND titulo LIKE 'Tipo de cambio 40.0000 confirmado por %: se aleja más de 5 % del anterior (36.6244)')
                         FROM v_alertas_pendientes WHERE tipo = 'TIPO_CAMBIO_FUERA_LIMITE'),
                      'confirmar un tipo de cambio fuera del límite deja una alerta al administrador (los que están dentro, no)');

\echo '\n=== 23. REPORTES (backend B7): VENTAS DE UN REPORTE, IMPRESIÓN DE TICKETS Y FOTO MENSUAL DEL INVENTARIO'
-- Rita solo tiene REPORTES_VER (sin CAJA_VER_DIFERENCIAS): un rol nuevo, de la sucursal POS
SELECT fn_crear_rol(:admin, 'ANALISTA', 'Analista de ventas');
SELECT fn_set_permisos_rol(:admin, 'ANALISTA', ARRAY['REPORTES_VER']);
SELECT fn_crear_usuario(:admin, 'Rita Reportes', 'rita.reportes', 'hash-de-prueba', 'ANALISTA', ARRAY[:pos]) AS rita \gset
-- Hasta aquí la sucursal POS tiene dos ventas, las dos en turnos ya cerrados. Se abre otro turno con dos ventas, una anulada
SELECT fn_abrir_turno(:paula, :caja_pos1, 500 + :aro_precio, 0) AS turno_rep \gset
SELECT fn_registrar_venta(:paula, :turno_rep, format('[{"variante_id":%s,"cantidad":1}]', :aro)::jsonb, format('[{"metodo":"EFECTIVO","monto":%s}]', :aro_precio)::jsonb) AS v_rep \gset
SELECT fn_registrar_venta(:paula, :turno_rep, format('[{"variante_id":%s,"cantidad":1}]', :aro)::jsonb, format('[{"metodo":"EFECTIVO","monto":%s}]', :aro_precio)::jsonb) AS v_rep_anulada \gset
SELECT fn_anular_venta(:admin, :v_rep_anulada, 'Venta de prueba anulada para el reporte');

SELECT pg_temp.afirma((SELECT count(*) = 3 AND bool_or(x = :v_rep) FROM fn_ventas_reporte(:admin, :'hoy', :'hoy', :pos) x),
                      'reportes: quien ve las diferencias de caja ve también las ventas del turno abierto');
SELECT pg_temp.afirma((SELECT count(*) = 2 AND NOT bool_or(x = :v_rep) FROM fn_ventas_reporte(:rita, :'hoy', :'hoy', :pos) x),
                      'reportes: sin CAJA_VER_DIFERENCIAS no entran las ventas de un turno todavía abierto');
SELECT pg_temp.afirma((SELECT count(*) FROM fn_ventas_reporte(:rita, :'hoy', :'hoy')) = 2, 'reportes: sin indicar sucursal, solo entran las suyas');
SELECT pg_temp.afirma((SELECT count(*) FROM fn_ventas_reporte(:rita, :'hoy', :'hoy', :lam)) = 0, 'reportes: de una sucursal ajena no entra nada');
SELECT pg_temp.afirma((SELECT count(*) FROM fn_ventas_reporte(:paula, :'hoy', :'hoy', :pos)) = 0, 'reportes: sin REPORTES_VER no entra ninguna venta');
SELECT pg_temp.afirma((SELECT count(*) > 0 AND bool_and(fn_puede_operar_sucursal(:maria, v.sucursal_id)) AND NOT bool_or(v.sucursal_id = :pos)
                         FROM fn_ventas_reporte(:maria, :'hoy'::date - 1, :'hoy') x JOIN venta v ON v.id = x),
                      'reportes: la encargada ve las ventas de sus sucursales, y solo esas');
SELECT pg_temp.afirma((SELECT count(*) FROM fn_ventas_reporte(:admin, :'hoy'::date - 30, :'hoy'::date - 1, :pos)) = 0, 'reportes: el rango es por día de Managua');
SELECT pg_temp.afirma((SELECT count(*) = 1 AND bool_and(x = :v_rep_anulada) FROM fn_ventas_reporte(:admin, :'hoy', :'hoy', :pos, 'ANULADA') x),
                      'reportes: las anuladas se piden aparte (no cuentan como venta)');
SELECT pg_temp.afirma((SELECT count(*) FROM fn_ventas_reporte(:rita, :'hoy', :'hoy', :pos, 'ANULADA')) = 0, 'reportes: tampoco las anuladas de un turno abierto');
SELECT fn_cierre_forzado(:admin, :turno_rep, 'Se cierra el turno de la prueba de reportes');
SELECT pg_temp.afirma((SELECT count(*) FROM fn_ventas_reporte(:rita, :'hoy', :'hoy', :pos)) = 3
                  AND (SELECT count(*) FROM fn_ventas_reporte(:rita, :'hoy', :'hoy', :pos, 'ANULADA')) = 1,
                      'reportes: cerrado el turno, sus ventas ya entran para todos');

-- Impresión de tickets: la primera es el original; desde la segunda, copia
SELECT pg_temp.afirma(fn_registrar_impresion_venta(:paula, :v_pos) = 1, 'ticket de venta: la primera impresión es el original');
SELECT pg_temp.afirma(fn_registrar_impresion_venta(:paula, :v_pos) = 2, 'ticket de venta: la segunda ya es copia');
SELECT pg_temp.afirma(fn_registrar_impresion_venta(:admin, :v_pos) = 3, 'ticket de venta: sigue siendo copia aunque la imprima otra persona');
SELECT pg_temp.afirma(fn_registrar_impresion_venta(:admin, :v_rep) = 1, 'ticket de venta: cada venta lleva su propia cuenta');
SELECT pg_temp.espera_error(format('SELECT fn_registrar_impresion_venta(%s, %s)', :carlos, :v_pos), 'No puede imprimir el ticket de la venta POS-00000001');
SELECT pg_temp.espera_error(format('SELECT fn_registrar_impresion_venta(%s, %s)', :rita, :v_pos), 'No puede imprimir el ticket de la venta');
SELECT pg_temp.espera_error(format('SELECT fn_registrar_impresion_venta(%s, 999999)', :admin), 'La venta 999999 no existe');
SELECT pg_temp.afirma(fn_registrar_impresion_cierre(:paula, :turno_pos) = 1, 'ticket de cierre: la primera impresión es el original');
SELECT pg_temp.afirma(fn_registrar_impresion_cierre(:admin, :turno_pos) = 2, 'ticket de cierre: la siguiente es copia');
SELECT pg_temp.espera_error(format('SELECT fn_registrar_impresion_cierre(%s, %s)', :carlos, :turno_pos), 'No puede imprimir el ticket de cierre');
SELECT pg_temp.espera_error(format('SELECT fn_registrar_impresion_cierre(%s, %s)', :rita, :turno_pos), 'No puede imprimir el ticket de cierre');
SELECT fn_abrir_turno(:paula, :caja_pos1, 0, 0) AS turno_rep2 \gset
SELECT pg_temp.espera_error(format('SELECT fn_registrar_impresion_cierre(%s, %s)', :paula, :turno_rep2), 'sigue abierto');
SELECT fn_cierre_forzado(:admin, :turno_rep2, 'Se cierra el turno de la prueba de impresión');
SELECT pg_temp.espera_error(format('SELECT fn_registrar_impresion_cierre(%s, 999999)', :admin), 'El turno 999999 no existe');
SELECT pg_temp.afirma((SELECT count(*) = 4 AND count(DISTINCT usuario_id) = 2 FROM ticket_impresion WHERE venta_id IN (:v_pos, :v_rep)), 'queda quién imprimió cada ticket (las impresiones rechazadas no)');
SELECT pg_temp.espera_error('DELETE FROM ticket_impresion', 'solo inserción');
SELECT pg_temp.espera_error(format('INSERT INTO ticket_impresion (venta_id, turno_id, usuario_id) VALUES (%s, %s, %s)', :v_pos, :turno_pos, :admin), 'ck_impresion_de');

-- Foto mensual del inventario valorizado: las cantidades salen del kardex
SELECT pg_temp.afirma(NOT EXISTS (
                        SELECT 1 FROM (SELECT sucursal_id, variante_id, sum(cantidad) AS cantidad FROM movimiento_inventario GROUP BY 1, 2) k
                          FULL JOIN stock_sucursal s USING (sucursal_id, variante_id)
                         WHERE coalesce(k.cantidad, 0) <> coalesce(s.cantidad, 0)),
                      'las existencias de cada pieza son la suma de sus movimientos (por eso la foto puede salir del kardex)');
SELECT date_trunc('month', :'hoy'::date)::date AS mes_actual \gset
SELECT (date_trunc('month', :'hoy'::date) - interval '1 month')::date AS mes_anterior \gset
-- Una entrada con fecha de hace 40 días: es lo único que había en la sucursal POS al cierre del mes anterior
INSERT INTO movimiento_inventario (sucursal_id, variante_id, tipo, cantidad, stock_resultante, motivo, usuario_id, fecha)
VALUES (:pos, :cad, 'ENTRADA', 3, 0, 'Entrada con fecha de hace 40 días (prueba de la foto mensual)', :admin, now() - interval '40 days');
SELECT pg_temp.afirma(fn_foto_inventario_mensual() >= 1, 'la tarea guarda la foto del mes que acaba de cerrar');
SELECT pg_temp.afirma((SELECT count(*) = 1 AND sum(unidades) = 3
                          AND sum(valor_costo) = 3 * (SELECT costo FROM variante WHERE id = :cad)
                          AND sum(valor_venta) = 3 * (SELECT precio_venta FROM variante WHERE id = :cad)
                         FROM inventario_cierre_mensual WHERE mes = :'mes_anterior' AND sucursal_id = :pos),
                      'la foto trae lo que había al cambiar de mes (los movimientos posteriores no entran), a costo y a precio de venta');
SELECT pg_temp.afirma(fn_foto_inventario_mensual() = 0 AND fn_foto_inventario_mensual(now() + interval '10 minutes') = 0, 'la foto de un mes se toma una sola vez');
SELECT pg_temp.afirma(fn_foto_inventario_mensual(now() + interval '1 month') >= 1, 'al cambiar de mes se toma la foto del mes que termina');
SELECT pg_temp.afirma((SELECT sum(unidades) FROM inventario_cierre_mensual WHERE mes = :'mes_actual') = (SELECT sum(unidades) FROM v_inventario_valorizado)
                  AND (SELECT sum(valor_costo) FROM inventario_cierre_mensual WHERE mes = :'mes_actual') = (SELECT sum(valor_costo) FROM v_inventario_valorizado)
                  AND (SELECT sum(valor_venta) FROM inventario_cierre_mensual WHERE mes = :'mes_actual') = (SELECT sum(valor_venta) FROM v_inventario_valorizado),
                      'con todos los movimientos, la foto coincide con el inventario valorizado de hoy');
SELECT pg_temp.espera_error(format('INSERT INTO inventario_cierre_mensual VALUES (%L, %s, 1, 1, 1, 1, now())', :'mes_actual'::date + 1, :pos), 'inventario_cierre_mensual_mes_check');

\echo '\n=== 24. DEVOLUCIONES Y CAMBIOS (backend B8)'
SELECT set_config('app.usuario_id', :'admin', false);
-- Dos sucursales propias: se vende en la A y una devolución se puede ejecutar en la B
SELECT fn_guardar_sucursal(:admin, NULL, 'dva', 'Sucursal Devoluciones A') AS dva \gset
SELECT fn_guardar_sucursal(:admin, NULL, 'dvb', 'Sucursal Devoluciones B') AS dvb \gset
SELECT fn_crear_caja(:admin, :dva, 'Caja 1') AS caja_dva \gset
SELECT fn_crear_caja(:admin, :dvb, 'Caja 1') AS caja_dvb \gset
SELECT fn_crear_usuario(:admin, 'Dora Devoluciones', 'dora.dev', 'hash-de-prueba', 'VENDEDOR', ARRAY[:dva]) AS dora \gset
SELECT fn_crear_usuario(:admin, 'Beto Devoluciones', 'beto.dev', 'hash-de-prueba', 'VENDEDOR', ARRAY[:dvb]) AS beto \gset
SELECT fn_crear_usuario(:admin, 'Elsa Devoluciones', 'elsa.dev', 'hash-de-prueba', 'ENCARGADO', ARRAY[:dva]) AS elsa \gset
SELECT fn_crear_usuario(:admin, 'Lina Devoluciones', 'lina.dev', 'hash-de-prueba', 'ANALISTA', ARRAY[:dva, :dvb]) AS lina \gset
SELECT fn_registrar_dispositivo(:admin, 'PC Caja DVA', 'CAJA', :dva, encode(sha256('dva-pc'), 'hex'), :caja_dva) AS pc_dva \gset
SELECT fn_registrar_dispositivo(:admin, 'PC Caja DVB', 'CAJA', :dvb, encode(sha256('dvb-pc'), 'hex'), :caja_dvb) AS pc_dvb \gset

-- La casilla "admite devolución" de las categorías
SELECT pg_temp.afirma((SELECT count(*) = 4 AND bool_and(NOT admite_devolucion) FROM categoria
                         WHERE nombre IN ('Perforaciones', 'Piercing titanio', 'Piercing acero', 'Piercing bioflex')),
                      'datos iniciales: las piezas de piercing y las perforaciones no admiten devolución');
SELECT pg_temp.afirma((SELECT count(*) = 7 AND bool_and(admite_devolucion) FROM categoria
                         WHERE nombre IN ('Cuidado posterior', 'Joyería plata 925', 'Joyería xuping', 'Joyería estilo Dubái',
                                          'Accesorios dama', 'Accesorios caballero', 'Perfumería')),
                      'datos iniciales: joyería, accesorios, perfumería y cuidado posterior sí la admiten');
SELECT fn_guardar_categoria(:admin, NULL, 'Regalos DEV') AS cat_dev \gset
SELECT pg_temp.afirma((SELECT NOT admite_devolucion FROM categoria WHERE id = :cat_dev), 'una categoría nueva nace sin admitir devoluciones');
SELECT pg_temp.espera_error(format('SELECT fn_set_categoria_devolucion(%s, %s, true)', :maria, :cat_dev), 'DEVOLUCIONES_APROBAR');
-- administrar el catálogo no alcanza: la casilla es de quien aprueba las devoluciones
SELECT fn_set_permisos_rol(:admin, 'ANALISTA', ARRAY['REPORTES_VER', 'PRODUCTOS_GESTIONAR']);
SELECT fn_guardar_categoria(:rita, :cat_dev, 'Regalos DEV', 'Categoría de las pruebas de devoluciones');
SELECT pg_temp.espera_error(format('SELECT fn_set_categoria_devolucion(%s, %s, true)', :rita, :cat_dev), 'DEVOLUCIONES_APROBAR');
SELECT pg_temp.afirma((SELECT NOT admite_devolucion AND descripcion IS NOT NULL FROM categoria WHERE id = :cat_dev), 'editar la categoría no toca la casilla');
SELECT fn_set_permisos_rol(:admin, 'ANALISTA', ARRAY['REPORTES_VER']);
SELECT pg_temp.espera_error(format('SELECT fn_set_categoria_devolucion(%s, 999999, true)', :admin), 'La categoría 999999 no existe');
SELECT pg_temp.espera_error(format('SELECT fn_set_categoria_devolucion(%s, (SELECT id FROM categoria WHERE nombre = %L), true)', :admin, 'Perforaciones'),
                            'Las perforaciones nunca se devuelven');
SELECT fn_set_categoria_devolucion(:admin, :cat_dev, true);
SELECT pg_temp.afirma((SELECT admite_devolucion FROM categoria WHERE id = :cat_dev), 'el administrador marca la casilla');

-- Catálogo de la prueba: cadena C$600 (costo 200) y perfume C$400 (costo 150); promoción del 10 %
SELECT fn_guardar_producto(:admin, NULL, :cat_dev, 'Regalo DEV') AS prod_dev \gset
SELECT fn_crear_variante(:admin, :prod_dev, 'DEV-CAD', 600, 'Cadena', 200) AS dcad \gset
SELECT fn_crear_variante(:admin, :prod_dev, 'DEV-PERF', 400, 'Perfume', 150) AS dperf \gset
SELECT fn_movimiento_inventario(:admin, :dva, :dcad, 'AJUSTE_POSITIVO', 10, 'Existencias para las pruebas de devoluciones');
SELECT fn_movimiento_inventario(:admin, :dva, :dperf, 'AJUSTE_POSITIVO', 10, 'Existencias para las pruebas de devoluciones');
SELECT fn_movimiento_inventario(:admin, :dva, :aro, 'AJUSTE_POSITIVO', 5, 'Existencias para las pruebas de devoluciones');
SELECT fn_guardar_promocion(:admin, NULL, 'Promo DEV 10 %', 'PORCENTAJE', 10) AS promo_dev \gset
SELECT fn_set_promocion_activa(:admin, :promo_dev, true);
SELECT fn_guardar_promocion(:admin, NULL, 'Promo DEV C$100', 'MONTO', 100) AS promo_monto \gset
SELECT fn_set_promocion_activa(:admin, :promo_monto, true);
SELECT pg_temp.afirma(fn_parametro_num('DEVOLUCION_DIAS_MAX') = 7 AND fn_parametro_num('DEVOLUCION_APROBADA_DIAS') = 3,
                      'parámetros: 7 días para solicitar y 3 para ejecutar la aprobada');

-- Las ventas (todas de Dora, en la sucursal A)
SELECT fn_abrir_turno(:dora, :caja_dva, 1000, 0) AS t_dva1 \gset
-- VA: cadena + perfume con la promoción del 10 % → C$900, en efectivo
SELECT fn_registrar_venta(:dora, :t_dva1, format('[{"variante_id":%s,"cantidad":1},{"variante_id":%s,"cantidad":1}]', :dcad, :dperf)::jsonb,
  '[{"metodo":"EFECTIVO","monto":900}]', :promo_dev) AS va \gset
-- VB: 3 perfumes (C$1200): C$400 en efectivo y C$800 con tarjeta
SELECT fn_registrar_venta(:dora, :t_dva1, format('[{"variante_id":%s,"cantidad":3}]', :dperf)::jsonb,
  '[{"metodo":"EFECTIVO","monto":400},{"metodo":"TARJETA","monto":800,"referencia":"V-800"}]') AS vb \gset
-- VC: un aro de piercing y una perforación (nada de eso se devuelve)
SELECT fn_registrar_venta(:dora, :t_dva1, format('[{"variante_id":%s,"cantidad":1},{"variante_id":%s,"cantidad":1}]', :aro, :lob)::jsonb,
  '[{"metodo":"EFECTIVO","monto":5000}]') AS vc \gset
-- VD: 2 cadenas con la promoción (C$1080), todo con tarjeta
SELECT fn_registrar_venta(:dora, :t_dva1, format('[{"variante_id":%s,"cantidad":2}]', :dcad)::jsonb,
  '[{"metodo":"TARJETA","monto":1080,"referencia":"V-1080"}]', :promo_dev) AS vd \gset
-- VE: una cadena pagada con US$ 20 (el vuelto, en córdobas)
SELECT fn_registrar_venta(:dora, :t_dva1, format('[{"variante_id":%s,"cantidad":1}]', :dcad)::jsonb,
  '[{"metodo":"EFECTIVO","moneda":"USD","monto":20}]') AS ve \gset
-- VF: una cadena, mitad en efectivo y mitad por transferencia
SELECT fn_registrar_venta(:dora, :t_dva1, format('[{"variante_id":%s,"cantidad":1}]', :dcad)::jsonb,
  '[{"metodo":"EFECTIVO","monto":300},{"metodo":"TRANSFERENCIA","monto":300,"referencia":"T-300"}]') AS vf \gset
-- VG: 3 cadenas y un perfume (C$2200) con C$100 de rebaja → C$2100: el reparto no da centavos exactos
SELECT fn_registrar_venta(:dora, :t_dva1, format('[{"variante_id":%s,"cantidad":3},{"variante_id":%s,"cantidad":1}]', :dcad, :dperf)::jsonb,
  '[{"metodo":"EFECTIVO","monto":2100}]', :promo_monto) AS vg \gset
SELECT id AS vg_cad  FROM venta_detalle WHERE venta_id = :vg AND variante_id = :dcad  \gset
SELECT id AS vg_perf FROM venta_detalle WHERE venta_id = :vg AND variante_id = :dperf \gset
SELECT id AS va_cad  FROM venta_detalle WHERE venta_id = :va AND variante_id = :dcad  \gset
SELECT id AS va_perf FROM venta_detalle WHERE venta_id = :va AND variante_id = :dperf \gset
SELECT id AS vb_perf FROM venta_detalle WHERE venta_id = :vb \gset
SELECT id AS vc_aro  FROM venta_detalle WHERE venta_id = :vc AND variante_id = :aro \gset
SELECT id AS vc_lob  FROM venta_detalle WHERE venta_id = :vc AND variante_id = :lob \gset
SELECT id AS vd_cad  FROM venta_detalle WHERE venta_id = :vd \gset
SELECT id AS ve_cad  FROM venta_detalle WHERE venta_id = :ve \gset
SELECT id AS vf_cad  FROM venta_detalle WHERE venta_id = :vf \gset

-- Con el turno abierto la venta se anula: la devolución es para turnos ya cerrados
SELECT pg_temp.espera_error(format($q$SELECT fn_solicitar_devolucion(%s, %L, %s, 'DEVOLUCION', 'No le gustó el aroma', 'Carla Cliente', '8888-1234', '[{"detalle_id":%s,"cantidad":1,"estado":"BUENO"}]')$q$,
                                   :dora, :'pc_dva', :va, :va_perf), 'es de un turno que sigue abierto: se anula, no se devuelve');
SELECT fn_cierre_forzado(:admin, :t_dva1, 'Cierre para las pruebas de devoluciones');
SELECT pg_temp.afirma(fn_venta_no_devoluble(:va) IS NULL, 'cerrado el turno, la venta ya se puede devolver');

-- Qué se puede devolver de cada factura y cuánto vale (lo pagado, con la promoción en proporción)
SELECT pg_temp.afirma((SELECT count(*) = 2 AND bool_and(admite AND disponible = 1 AND devuelta = 0 AND apartada = 0 AND motivo_no IS NULL)
                          AND sum(neto_linea) = 900
                          AND max(neto_linea) FILTER (WHERE detalle_id = :va_cad) = 540
                          AND max(neto_linea) FILTER (WHERE detalle_id = :va_perf) = 360
                         FROM fn_lineas_devolubles(:va)),
                      'la cadena de C$600 y el perfume de C$400 con 10 % de promoción valen C$540 y C$360 (suman lo pagado)');
SELECT pg_temp.afirma((SELECT NOT admite AND motivo_no = 'La categoría "Piercing acero" no admite devoluciones' FROM fn_lineas_devolubles(:vc) WHERE detalle_id = :vc_aro)
                  AND (SELECT NOT admite AND motivo_no = 'Las perforaciones y los paquetes no se devuelven ni se cambian' FROM fn_lineas_devolubles(:vc) WHERE detalle_id = :vc_lob),
                      'una pieza de piercing y una perforación no se pueden devolver, y dice por qué');
-- Centavos: lo pagado por la factura VG (C$2100) se reparte entre sus líneas y sus unidades sin perder ni uno
SELECT pg_temp.afirma((SELECT max(neto_linea) FILTER (WHERE detalle_id = :vg_cad) = 1718.18 AND max(neto_linea) FILTER (WHERE detalle_id = :vg_perf) = 381.82
                         FROM fn_lineas_devolubles(:vg)),
                      'con una rebaja que no da centavos exactos, las líneas siguen sumando lo pagado: 1718.18 + 381.82 = 2100');
SELECT fn_solicitar_devolucion(:dora, :'pc_dva', :vg, 'DEVOLUCION', 'Prueba de centavos: primera cadena', 'Rosa Cliente', '8333-4444',
  format('[{"detalle_id":%s,"cantidad":1,"estado":"BUENO"}]', :vg_cad)::jsonb) AS r1 \gset
SELECT fn_solicitar_devolucion(:dora, :'pc_dva', :vg, 'DEVOLUCION', 'Prueba de centavos: segunda cadena', 'Rosa Cliente', '8333-4444',
  format('[{"detalle_id":%s,"cantidad":1,"estado":"BUENO"}]', :vg_cad)::jsonb) AS r2 \gset
SELECT fn_solicitar_devolucion(:dora, :'pc_dva', :vg, 'DEVOLUCION', 'Prueba de centavos: lo que queda', 'Rosa Cliente', '8333-4444',
  format('[{"detalle_id":%s,"cantidad":1,"estado":"BUENO"},{"detalle_id":%s,"cantidad":1,"estado":"DEFECTUOSO"}]', :vg_perf, :vg_cad)::jsonb) AS r3 \gset
SELECT pg_temp.afirma((SELECT monto_total FROM devolucion WHERE id = :r1) = 572.73 AND (SELECT monto_total FROM devolucion WHERE id = :r2) = 572.72
                  AND (SELECT monto_total FROM devolucion WHERE id = :r3) = 954.55
                  AND (SELECT sum(monto_total) FROM devolucion WHERE id IN (:r1, :r2, :r3)) = 2100,
                      'devuelta por partes, una factura devuelve exactamente lo que se pagó por ella (572.73 + 572.72 + 954.55 = 2100)');
SELECT fn_cancelar_devolucion(:dora, :r1, 'Era solo la prueba de centavos');
SELECT fn_cancelar_devolucion(:dora, :r2, 'Era solo la prueba de centavos');
SELECT fn_cancelar_devolucion(:dora, :r3, 'Era solo la prueba de centavos');
SELECT pg_temp.afirma((SELECT fn_proporcion_efectivo(:va) = 1 AND fn_proporcion_efectivo(:vd) = 0 AND fn_proporcion_efectivo(:ve) = 1
                              AND fn_proporcion_efectivo(:vf) = 0.5 AND round(fn_proporcion_efectivo(:vb), 4) = 0.3333),
                      'cuánto de cada venta se pagó en efectivo (los dólares cuentan como efectivo y el vuelto se resta)');
SELECT pg_temp.afirma((SELECT efectivo = 133.33 AND transferencia = 266.67 FROM fn_reparto_devolucion(:vb, 400))
                  AND (SELECT efectivo = 360 AND transferencia = 0 FROM fn_reparto_devolucion(:va, 360))
                  AND (SELECT efectivo = 0 AND transferencia = 540 FROM fn_reparto_devolucion(:vd, 540)),
                      'el reembolso se reparte como se pagó: efectivo desde la caja y el resto por transferencia');

-- Solicitud: quién puede y qué se le exige
SELECT pg_temp.espera_error(format($q$SELECT fn_solicitar_devolucion(%s, %L, %s, 'DEVOLUCION', 'No le gustó el aroma', 'Carla Cliente', '8888-1234', '[{"detalle_id":%s,"cantidad":1,"estado":"BUENO"}]')$q$,
                                   :rita, :'pc_dva', :va, :va_perf), 'DEVOLUCIONES_REGISTRAR');
SELECT pg_temp.espera_error(format($q$SELECT fn_solicitar_devolucion(%s, %L, %s, 'DEVOLUCION', 'No le gustó el aroma', 'Carla Cliente', '8888-1234', '[{"detalle_id":%s,"cantidad":1,"estado":"BUENO"}]')$q$,
                                   :carlos, :'pc_dva', :va, :va_perf), 'equipo registrado y activo');
SELECT pg_temp.espera_error(format($q$SELECT fn_solicitar_devolucion(%s, NULL, %s, 'DEVOLUCION', 'No le gustó el aroma', 'Carla Cliente', '8888-1234', '[{"detalle_id":%s,"cantidad":1,"estado":"BUENO"}]')$q$,
                                   :dora, :va, :va_perf), 'equipo registrado y activo');
SELECT pg_temp.espera_error(format($q$SELECT fn_solicitar_devolucion(%s, %L, 999999, 'DEVOLUCION', 'No le gustó el aroma', 'Carla Cliente', '8888-1234', '[{"detalle_id":1,"cantidad":1,"estado":"BUENO"}]')$q$,
                                   :dora, :'pc_dva'), 'La venta 999999 no existe');
SELECT pg_temp.espera_error(format($q$SELECT fn_solicitar_devolucion(%s, %L, %s, 'REGALO', 'No le gustó el aroma', 'Carla Cliente', '8888-1234', '[{"detalle_id":%s,"cantidad":1,"estado":"BUENO"}]')$q$,
                                   :dora, :'pc_dva', :va, :va_perf), 'Indique si es una devolución o un cambio');
SELECT pg_temp.espera_error(format($q$SELECT fn_solicitar_devolucion(%s, %L, %s, 'DEVOLUCION', 'no', 'Carla Cliente', '8888-1234', '[{"detalle_id":%s,"cantidad":1,"estado":"BUENO"}]')$q$,
                                   :dora, :'pc_dva', :va, :va_perf), 'Escriba el motivo de la devolución');
SELECT pg_temp.espera_error(format($q$SELECT fn_solicitar_devolucion(%s, %L, %s, 'DEVOLUCION', 'No le gustó el aroma', ' ', '8888-1234', '[{"detalle_id":%s,"cantidad":1,"estado":"BUENO"}]')$q$,
                                   :dora, :'pc_dva', :va, :va_perf), 'Escriba el nombre del cliente');
SELECT pg_temp.espera_error(format($q$SELECT fn_solicitar_devolucion(%s, %L, %s, 'DEVOLUCION', 'No le gustó el aroma', 'Carla Cliente', NULL, '[{"detalle_id":%s,"cantidad":1,"estado":"BUENO"}]')$q$,
                                   :dora, :'pc_dva', :va, :va_perf), 'Escriba el teléfono del cliente');
SELECT pg_temp.espera_error(format($q$SELECT fn_solicitar_devolucion(%s, %L, %s, 'DEVOLUCION', 'No le gustó el aroma', 'Carla Cliente', '8888-1234', '[]')$q$,
                                   :dora, :'pc_dva', :va), 'Indique al menos un producto para devolver');
SELECT pg_temp.espera_error(format($q$SELECT fn_solicitar_devolucion(%s, %L, %s, 'DEVOLUCION', 'No le gustó el aroma', 'Carla Cliente', '8888-1234', '[{"detalle_id":%s,"cantidad":1,"estado":"BUENO"}]')$q$,
                                   :dora, :'pc_dva', :va, :vb_perf), 'no es de la venta DVA-00000001');
SELECT pg_temp.espera_error(format($q$SELECT fn_solicitar_devolucion(%s, %L, %s, 'DEVOLUCION', 'No le gustó el aroma', 'Carla Cliente', '8888-1234', '[{"detalle_id":%s,"cantidad":1,"estado":"USADO"}]')$q$,
                                   :dora, :'pc_dva', :va, :va_perf), 'BUENO o DEFECTUOSO');
SELECT pg_temp.espera_error(format($q$SELECT fn_solicitar_devolucion(%s, %L, %s, 'DEVOLUCION', 'No le gustó el aroma', 'Carla Cliente', '8888-1234', '[{"detalle_id":%s,"cantidad":0,"estado":"BUENO"}]')$q$,
                                   :dora, :'pc_dva', :va, :va_perf), 'Cantidad inválida');
SELECT pg_temp.espera_error(format($q$SELECT fn_solicitar_devolucion(%s, %L, %s, 'DEVOLUCION', 'No le gustó el aroma', 'Carla Cliente', '8888-1234', '[{"detalle_id":%s,"cantidad":2,"estado":"BUENO"}]')$q$,
                                   :dora, :'pc_dva', :va, :va_perf), 'solo queda(n) 1 por devolver');
-- Nunca se devuelven ni se cambian piezas ni perforaciones
SELECT pg_temp.espera_error(format($q$SELECT fn_solicitar_devolucion(%s, %L, %s, 'CAMBIO', 'Quiere otro modelo', 'Carla Cliente', '8888-1234', '[{"detalle_id":%s,"cantidad":1,"estado":"BUENO"}]')$q$,
                                   :dora, :'pc_dva', :vc, :vc_aro), 'no se puede devolver: la categoría "Piercing acero" no admite devoluciones');
SELECT pg_temp.espera_error(format($q$SELECT fn_solicitar_devolucion(%s, %L, %s, 'DEVOLUCION', 'Se arrepintió de la perforación', 'Carla Cliente', '8888-1234', '[{"detalle_id":%s,"cantidad":1,"estado":"BUENO"}]')$q$,
                                   :dora, :'pc_dva', :vc, :vc_lob), 'las perforaciones y los paquetes no se devuelven ni se cambian');
-- El plazo: 7 días calendario desde el día de la venta (parámetro DEVOLUCION_DIAS_MAX)
BEGIN;
ALTER TABLE venta DISABLE TRIGGER tg_venta_proteger;
UPDATE venta SET fecha = now() - interval '7 days' WHERE id = :ve;
SELECT pg_temp.afirma(fn_venta_no_devoluble(:ve) IS NULL, 'una venta de hace 7 días todavía se puede devolver');
UPDATE venta SET fecha = now() - interval '8 days' WHERE id = :ve;
SELECT pg_temp.espera_error(format($q$SELECT fn_solicitar_devolucion(%s, %L, %s, 'DEVOLUCION', 'No le gustó la cadena', 'Carla Cliente', '8888-1234', '[{"detalle_id":%s,"cantidad":1,"estado":"BUENO"}]')$q$,
                                   :dora, :'pc_dva', :ve, :ve_cad), 'el plazo de 7 días para devolverla venció el');
SELECT fn_set_parametro(:admin, 'DEVOLUCION_DIAS_MAX', '10');
SELECT pg_temp.afirma(fn_venta_no_devoluble(:ve) IS NULL, 'el plazo sale del parámetro: con 10 días, la de hace 8 entra');
ROLLBACK;
SELECT pg_temp.espera_error(format('SELECT fn_set_parametro(%s, %L, %L)', :admin, 'DEVOLUCION_DIAS_MAX', '0'), 'no puede ser menor que 1');

\echo 'S1: devolución de un perfume pagado en efectivo; se solicita en A y se ejecuta en B'
SELECT fn_solicitar_devolucion(:dora, :'pc_dva', :va, 'devolucion', '  No le gustó el aroma ', ' Carla Cliente ', '8888-1234',
  format('[{"detalle_id":%s,"cantidad":1,"estado":"bueno"}]', :va_perf)::jsonb) AS s1 \gset
SELECT pg_temp.afirma((SELECT estado = 'PENDIENTE' AND tipo = 'DEVOLUCION' AND monto_total = 360 AND sucursal_solicitud_id = :dva
                              AND solicitada_por = :dora AND motivo = 'No le gustó el aroma' AND cliente_nombre = 'Carla Cliente'
                              AND numero IS NULL AND monto_efectivo IS NULL
                         FROM devolucion WHERE id = :s1)
                  AND (SELECT count(*) = 1 AND bool_and(cantidad = 1 AND estado_producto = 'BUENO' AND monto = 360 AND movimiento_id IS NULL)
                         FROM devolucion_detalle WHERE devolucion_id = :s1),
                      'la solicitud queda pendiente, en la sucursal del equipo, con lo pagado por el perfume: C$360');
SELECT pg_temp.afirma((SELECT count(*) = 1 AND bool_and(titulo = 'Devolución por aprobar: factura DVA-00000001, C$ 360.00' AND ubicacion = 'Sucursal Devoluciones A')
                         FROM v_alertas_pendientes WHERE tipo = 'DEVOLUCION_PENDIENTE' AND (detalle->>'devolucion_id')::bigint = :s1),
                      'al crearse la solicitud se genera una alerta para el administrador');
SELECT pg_temp.afirma((SELECT apartada = 1 AND disponible = 0 AND devuelta = 0 AND motivo_no = 'Ya se devolvió o está en otra solicitud'
                         FROM fn_lineas_devolubles(:va) WHERE detalle_id = :va_perf),
                      'lo pedido en una solicitud pendiente queda apartado');
SELECT pg_temp.espera_error(format($q$SELECT fn_solicitar_devolucion(%s, %L, %s, 'CAMBIO', 'Ahora quiere cambiarlo', 'Carla Cliente', '8888-1234', '[{"detalle_id":%s,"cantidad":1,"estado":"BUENO"}]')$q$,
                                   :elsa, :'pc_dva', :va, :va_perf), 'solo queda(n) 0 por devolver');
SELECT pg_temp.afirma((SELECT subtotal = 1000 AND descuento = 100 AND total = 900 AND estado = 'COMPLETADA' FROM venta WHERE id = :va), 'la factura original no cambia');
-- Solo el administrador aprueba o rechaza
SELECT pg_temp.espera_error(format('SELECT fn_resolver_devolucion(%s, %s, true)', :dora, :s1), 'DEVOLUCIONES_APROBAR');
SELECT pg_temp.espera_error(format('SELECT fn_resolver_devolucion(%s, %s, true)', :elsa, :s1), 'DEVOLUCIONES_APROBAR');
SELECT pg_temp.espera_error(format('SELECT fn_resolver_devolucion(%s, 999999, true)', :admin), 'La devolución 999999 no existe');
SELECT pg_temp.espera_error(format('SELECT fn_resolver_devolucion(%s, %s, false)', :admin, :s1), 'Para rechazar una devolución escriba el motivo');
SELECT pg_temp.espera_error(format('SELECT fn_resolver_devolucion(%s, %s, NULL)', :admin, :s1), 'Indique si la aprueba o la rechaza');
SELECT fn_abrir_turno(:beto, :caja_dvb, 500, 0) AS t_dvb \gset
SELECT pg_temp.espera_error(format('SELECT fn_ejecutar_devolucion(%s, %s, %s)', :beto, :s1, :t_dvb), 'está pendiente: solo se ejecuta una aprobada');
SELECT fn_resolver_devolucion(:admin, :s1, true, 'Proceda');
SELECT pg_temp.afirma((SELECT estado = 'APROBADA' AND resuelta_por = :admin AND comentario = 'Proceda' AND vence_el = :'hoy'::date + 3 FROM devolucion WHERE id = :s1)
                  AND NOT EXISTS (SELECT 1 FROM v_alertas_pendientes WHERE tipo = 'DEVOLUCION_PENDIENTE' AND (detalle->>'devolucion_id')::bigint = :s1),
                      'aprobada: tiene 3 días para ejecutarse y su alerta queda atendida');
SELECT pg_temp.espera_error(format('SELECT fn_resolver_devolucion(%s, %s, false, %L)', :admin, :s1, 'Mejor no'), 'ya fue aprobada');
-- Se ejecuta en la caja abierta de la sucursal donde está el cliente (aquí, la B)
SELECT pg_temp.espera_error(format('SELECT fn_ejecutar_devolucion(%s, %s, %s)', :rita, :s1, :t_dvb), 'DEVOLUCIONES_REGISTRAR');
SELECT pg_temp.espera_error(format('SELECT fn_ejecutar_devolucion(%s, %s, %s)', :dora, :s1, :t_dvb), 'no está asignado a la sucursal');
SELECT pg_temp.espera_error(format('SELECT fn_ejecutar_devolucion(%s, %s, %s)', :dora, :s1, :t_dva1), 'No hay un turno abierto');
SELECT pg_temp.espera_error(format($q$SELECT fn_ejecutar_devolucion(%s, %s, %s, '[{"variante_id":%s,"cantidad":1}]')$q$, :beto, :s1, :t_dvb, :dcad),
                            'es una devolución, no un cambio');
SELECT pg_temp.afirma(fn_puede_ver_devolucion(:beto, :s1) AND fn_puede_ver_devolucion(:carlos, :s1) AND NOT fn_puede_ver_devolucion(:rita, :s1),
                      'una aprobada la ve cualquier vendedor (se puede ejecutar donde aparezca el cliente); quien no registra devoluciones, no');
SELECT fn_ejecutar_devolucion(:beto, :s1, :t_dvb);
SELECT pg_temp.afirma((SELECT estado = 'EJECUTADA' AND numero = 'DEV-DVB-000001' AND sucursal_id = :dvb AND turno_id = :t_dvb AND ejecutada_por = :beto
                              AND monto_saldo = 0 AND monto_efectivo = 360 AND monto_transferencia = 0 AND venta_cambio_id IS NULL
                         FROM devolucion WHERE id = :s1),
                      'ejecutada en la otra sucursal, con su número propio: como se pagó en efectivo, los C$360 salen de la caja');
SELECT pg_temp.afirma((SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :dvb AND variante_id = :dperf) = 1
                  AND (SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :dva AND variante_id = :dperf) = 5,
                      'lo devuelto en buen estado entra al stock de la sucursal donde se ejecuta');
SELECT pg_temp.afirma((SELECT count(*) = 1 AND bool_and(m.tipo = 'DEVOLUCION' AND m.cantidad = 1 AND m.sucursal_id = :dvb AND m.costo_unitario = 150
                                                       AND m.motivo = 'Devolución DEV-DVB-000001 de la factura DVA-00000001' AND dd.movimiento_id = m.id AND dd.merma_id IS NULL)
                         FROM movimiento_inventario m JOIN devolucion_detalle dd ON dd.devolucion_id = m.devolucion_id
                        WHERE m.devolucion_id = :s1),
                      'queda en el kardex como DEVOLUCION, al costo con que se vendió');
SELECT pg_temp.afirma((SELECT monto_esperado FROM fn_resumen_turno(:t_dvb) WHERE metodo = 'Efectivo' AND moneda = 'NIO') = 140,
                      'el efectivo devuelto cuenta en lo esperado del arqueo: 500 − 360 = 140');
SELECT pg_temp.afirma((SELECT devuelta = 1 AND apartada = 0 AND disponible = 0 FROM fn_lineas_devolubles(:va) WHERE detalle_id = :va_perf)
                  AND (SELECT subtotal = 1000 AND total = 900 AND estado = 'COMPLETADA' FROM venta WHERE id = :va)
                  AND (SELECT count(*) = 2 FROM venta_detalle WHERE venta_id = :va),
                      'la factura original sigue igual; el perfume ya consta como devuelto');
SELECT pg_temp.espera_error(format('SELECT fn_ejecutar_devolucion(%s, %s, %s)', :beto, :s1, :t_dvb), 'ya se ejecutó (DEV-DVB-000001)');
SELECT pg_temp.espera_error(format('SELECT fn_registrar_transferencia_devolucion(%s, %s, %L)', :admin, :s1, 'BAC-1'), 'no tiene nada que transferir');
SELECT pg_temp.espera_error(format('SELECT fn_cancelar_devolucion(%s, %s, %L)', :admin, :s1, 'Ya no la quiere'), 'ya fue ejecutada y no se puede cancelar');
-- Una devolución no se borra ni se reescribe
SELECT pg_temp.espera_error(format('UPDATE devolucion SET monto_total = 1 WHERE id = %s', :s1), 'no se modifican');
SELECT pg_temp.espera_error(format('UPDATE devolucion SET monto_efectivo = 0, monto_transferencia = 360 WHERE id = %s', :s1), 'ya se ejecutó: solo se le anota la transferencia');
SELECT pg_temp.espera_error(format('UPDATE devolucion SET estado = %L WHERE id = %s', 'PENDIENTE', :s1), 'ya se ejecutó');
SELECT pg_temp.espera_error(format('DELETE FROM devolucion WHERE id = %s', :s1), 'no se eliminan');
SELECT pg_temp.espera_error(format('DELETE FROM devolucion_detalle WHERE devolucion_id = %s', :s1), 'no se eliminan');
SELECT pg_temp.espera_error(format('UPDATE devolucion_detalle SET cantidad = 5 WHERE devolucion_id = %s', :s1), 'no se modifican');
SELECT pg_temp.espera_error(format('INSERT INTO devolucion_detalle (devolucion_id, venta_detalle_id, cantidad, estado_producto, monto) VALUES (%s, %s, 1, %L, 1)', :s1, :va_cad, 'BUENO'),
                            'se registran al crear la solicitud');
SELECT pg_temp.espera_error(format('INSERT INTO movimiento_inventario (sucursal_id, variante_id, tipo, cantidad, stock_resultante, usuario_id) VALUES (%s, %s, %L, 1, 0, %s)', :dva, :dperf, 'DEVOLUCION', :admin),
                            'ck_mov_devolucion');

\echo 'S2: dos perfumes de una venta pagada 1/3 en efectivo; uno vuelve bueno y otro defectuoso'
SELECT fn_solicitar_devolucion(:dora, :'pc_dva', :vb, 'DEVOLUCION', 'Uno venía con el atomizador roto', 'Luis Cliente', '7777-0000',
  format('[{"detalle_id":%s,"cantidad":1,"estado":"DEFECTUOSO"},{"detalle_id":%s,"cantidad":1,"estado":"BUENO"}]', :vb_perf, :vb_perf)::jsonb) AS s2 \gset
SELECT pg_temp.afirma((SELECT monto_total = 800 FROM devolucion WHERE id = :s2)
                  AND (SELECT count(*) = 2 AND bool_and(cantidad = 1 AND monto = 400) FROM devolucion_detalle WHERE devolucion_id = :s2),
                      'una línea puede ir en parte buena y en parte defectuosa: 2 de 3 perfumes, C$800');
SELECT fn_resolver_devolucion(:admin, :s2, true);
SELECT fn_abrir_turno(:dora, :caja_dva, 5000, 0) AS t_dva2 \gset
SELECT fn_ejecutar_devolucion(:dora, :s2, :t_dva2);
SELECT pg_temp.afirma((SELECT numero = 'DEV-DVA-000001' AND monto_efectivo = 266.67 AND monto_transferencia = 533.33 AND monto_saldo = 0
                              AND transferida_at IS NULL FROM devolucion WHERE id = :s2),
                      'pago mixto: 1/3 de los C$800 sale en efectivo de la caja (266.67) y el resto queda para transferir (533.33)');
SELECT pg_temp.afirma((SELECT monto_esperado FROM fn_resumen_turno(:t_dva2) WHERE metodo = 'Efectivo' AND moneda = 'NIO') = 4733.33
                  AND NOT EXISTS (SELECT 1 FROM fn_resumen_turno(:t_dva2) WHERE metodo <> 'Efectivo'),
                      'al arqueo solo entra el efectivo: lo que se transfiere no pasa por la caja');
SELECT pg_temp.afirma((SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :dva AND variante_id = :dperf) = 6,
                      'entran los dos perfumes y el defectuoso sale enseguida: 5 + 2 − 1 = 6');
SELECT pg_temp.afirma((SELECT count(*) = 1 AND bool_and(me.estado = 'APROBADA' AND me.cantidad = 1 AND me.sucursal_id = :dva AND me.reportada_por = :dora
                                                       AND me.resuelta_por = :admin AND me.motivo = 'Devuelto defectuoso (DEV-DVA-000001): Uno venía con el atomizador roto'
                                                       AND mo.tipo = 'MERMA' AND mo.cantidad = -1 AND mo.costo_unitario = 150 AND dd.estado_producto = 'DEFECTUOSO')
                         FROM devolucion_detalle dd JOIN merma me ON me.id = dd.merma_id JOIN movimiento_inventario mo ON mo.id = me.movimiento_id
                        WHERE dd.devolucion_id = :s2)
                  AND (SELECT count(*) = 2 AND sum(cantidad) = 2 FROM movimiento_inventario WHERE devolucion_id = :s2),
                      'lo defectuoso entra como merma ya aprobada; todo queda en el kardex');
SELECT pg_temp.afirma((SELECT count(*) = 1 AND bool_and(titulo = 'Devolución DEV-DVA-000001: falta transferirle al cliente C$ 533.33' AND (detalle->>'monto')::numeric = 533.33)
                         FROM v_alertas_pendientes WHERE tipo = 'DEVOLUCION_TRANSFERENCIA' AND (detalle->>'devolucion_id')::bigint = :s2),
                      'queda una alerta para que el administrador haga la transferencia');
SELECT pg_temp.espera_error(format('SELECT fn_registrar_transferencia_devolucion(%s, %s, %L)', :dora, :s2, 'BAC-778899'), 'DEVOLUCIONES_APROBAR');
SELECT pg_temp.espera_error(format('SELECT fn_registrar_transferencia_devolucion(%s, %s, %L)', :admin, :s2, ' x '), 'Escriba la referencia de la transferencia');
SELECT fn_registrar_transferencia_devolucion(:admin, :s2, ' BAC-778899 ');
SELECT pg_temp.afirma((SELECT transferencia_referencia = 'BAC-778899' AND transferida_por = :admin AND transferida_at IS NOT NULL FROM devolucion WHERE id = :s2)
                  AND NOT EXISTS (SELECT 1 FROM v_alertas_pendientes WHERE tipo = 'DEVOLUCION_TRANSFERENCIA' AND (detalle->>'devolucion_id')::bigint = :s2)
                  AND (SELECT monto_esperado FROM fn_resumen_turno(:t_dva2) WHERE metodo = 'Efectivo' AND moneda = 'NIO') = 4733.33,
                      'la transferencia queda anotada con su referencia y no mueve la caja');
SELECT pg_temp.espera_error(format('SELECT fn_registrar_transferencia_devolucion(%s, %s, %L)', :admin, :s2, 'BAC-000'), 'ya está anotada (BAC-778899)');

\echo 'Cancelar, rechazar y vencer: en los tres casos se libera lo apartado'
SELECT fn_solicitar_devolucion(:dora, :'pc_dva', :vb, 'DEVOLUCION', 'El tercero tampoco le gustó', 'Luis Cliente', '7777-0000',
  format('[{"detalle_id":%s,"cantidad":1,"estado":"BUENO"}]', :vb_perf)::jsonb) AS s3 \gset
SELECT pg_temp.afirma((SELECT monto_total = 400 FROM devolucion WHERE id = :s3) AND (SELECT disponible = 0 AND apartada = 1 AND devuelta = 2 AND asignado = 1200 FROM fn_lineas_devolubles(:vb)),
                      'la última unidad completa lo pagado por la línea: nunca se devuelve más de lo que se pagó');
SELECT pg_temp.espera_error(format('SELECT fn_cancelar_devolucion(%s, %s, %L)', :beto, :s3, 'No era mía'), 'Solo quien hizo la solicitud o el administrador');
SELECT pg_temp.espera_error(format('SELECT fn_cancelar_devolucion(%s, %s, %L)', :dora, :s3, 'no'), 'Escriba por qué se cancela');
SELECT fn_cancelar_devolucion(:dora, :s3, 'El cliente se lo quedó');
SELECT pg_temp.afirma((SELECT estado = 'CANCELADA' AND cancelada_por = :dora AND motivo_cancelacion = 'El cliente se lo quedó' FROM devolucion WHERE id = :s3)
                  AND (SELECT disponible = 1 AND apartada = 0 FROM fn_lineas_devolubles(:vb))
                  AND NOT EXISTS (SELECT 1 FROM v_alertas_pendientes WHERE tipo = 'DEVOLUCION_PENDIENTE' AND (detalle->>'devolucion_id')::bigint = :s3),
                      'quien la solicitó la cancela: se libera lo apartado y se atiende su alerta');
SELECT pg_temp.espera_error(format('SELECT fn_cancelar_devolucion(%s, %s, %L)', :admin, :s3, 'Otra vez'), 'ya fue cancelada');
SELECT pg_temp.espera_error(format('SELECT fn_resolver_devolucion(%s, %s, true)', :admin, :s3), 'ya fue cancelada');
SELECT fn_solicitar_devolucion(:dora, :'pc_dva', :vb, 'DEVOLUCION', 'Insiste en devolver el tercero', 'Luis Cliente', '7777-0000',
  format('[{"detalle_id":%s,"cantidad":1,"estado":"BUENO"}]', :vb_perf)::jsonb) AS s4 \gset
SELECT fn_resolver_devolucion(:admin, :s4, false, 'El perfume viene usado');
SELECT pg_temp.afirma((SELECT estado = 'RECHAZADA' AND comentario = 'El perfume viene usado' AND vence_el IS NULL FROM devolucion WHERE id = :s4)
                  AND (SELECT disponible = 1 FROM fn_lineas_devolubles(:vb)),
                      'rechazada con su comentario: no aparta nada');
SELECT pg_temp.espera_error(format('SELECT fn_ejecutar_devolucion(%s, %s, %s)', :dora, :s4, :t_dva2), 'está rechazada: solo se ejecuta una aprobada');
SELECT pg_temp.espera_error(format('UPDATE devolucion SET estado = %L WHERE id = %s', 'APROBADA', :s4), 'ya fue rechazada y no se modifica');
SELECT fn_solicitar_devolucion(:dora, :'pc_dva', :vb, 'DEVOLUCION', 'Vuelve a pedir la devolución', 'Luis Cliente', '7777-0000',
  format('[{"detalle_id":%s,"cantidad":1,"estado":"BUENO"}]', :vb_perf)::jsonb) AS s5 \gset
SELECT fn_resolver_devolucion(:admin, :s5, true);
SELECT pg_temp.afirma(fn_vencer_devoluciones() = 0 AND fn_vencer_devoluciones(now() + interval '3 days') = 0,
                      'la aprobada sigue viva hasta su tercer día inclusive');
BEGIN;
UPDATE devolucion SET vence_el = :'hoy'::date - 1 WHERE id = :s5;
SELECT pg_temp.espera_error(format('SELECT fn_ejecutar_devolucion(%s, %s, %s)', :dora, :s5, :t_dva2), 'venció el');
ROLLBACK;
SELECT pg_temp.afirma(fn_vencer_devoluciones(now() + interval '4 days') = 1, 'pasado el plazo, la tarea la cancela sola');
SELECT pg_temp.afirma((SELECT estado = 'CANCELADA' AND cancelada_por IS NULL AND motivo_cancelacion LIKE 'Venció: estaba aprobada y no se ejecutó hasta el %' FROM devolucion WHERE id = :s5)
                  AND (SELECT disponible = 1 AND apartada = 0 FROM fn_lineas_devolubles(:vb))
                  AND (SELECT estado = 'EJECUTADA' FROM devolucion WHERE id = :s2),
                      'la vencida queda cancelada (sin usuario: venció sola) y libera lo apartado; las demás no se tocan');
SELECT pg_temp.espera_error(format('SELECT fn_ejecutar_devolucion(%s, %s, %s)', :dora, :s5, :t_dva2), 'está cancelada');

\echo 'La que vence deja dos alertas: una para el administrador y otra para la sucursal que la solicitó'
SELECT pg_temp.afirma((SELECT count(*) = 2 AND count(*) FILTER (WHERE para_sucursal) = 1
                              AND bool_and(ubicacion = 'Sucursal Devoluciones A')
                              AND bool_and(titulo = format('Venció la devolución aprobada de la factura %s: no se ejecutó hasta el %s',
                                                           (SELECT numero FROM venta WHERE id = :vb), to_char(:'hoy'::date + 3, 'DD/MM/YYYY')))
                              AND bool_and((detalle->>'venta_id')::bigint = :vb AND (detalle->>'solicitada_por')::bigint = :dora
                                           AND detalle->>'tipo' = 'DEVOLUCION' AND (detalle->>'vence_el')::date = :'hoy'::date + 3)
                         FROM v_alertas_pendientes WHERE tipo = 'DEVOLUCION_VENCIDA' AND (detalle->>'devolucion_id')::bigint = :s5),
                      'al vencer quedan dos alertas pendientes: la del panel y la de la sucursal que la solicitó');
SELECT pg_temp.afirma(fn_vencer_devoluciones(now() + interval '4 days') = 0
                  AND (SELECT count(*) = 2 FROM alerta WHERE tipo = 'DEVOLUCION_VENCIDA'),
                      'la tarea no la vuelve a vencer ni repite las alertas (las que se cancelan a mano no dejan alerta)');
SELECT id AS al_panel FROM alerta WHERE tipo = 'DEVOLUCION_VENCIDA' AND (detalle->>'devolucion_id')::bigint = :s5 AND NOT para_sucursal \gset
SELECT id AS al_suc   FROM alerta WHERE tipo = 'DEVOLUCION_VENCIDA' AND (detalle->>'devolucion_id')::bigint = :s5 AND para_sucursal \gset
SELECT pg_temp.afirma(fn_puede_ver_alerta(:dora, :al_suc) AND fn_puede_ver_alerta(:elsa, :al_suc) AND NOT fn_puede_ver_alerta(:beto, :al_suc)
                  AND NOT fn_puede_ver_alerta(:dora, :al_panel) AND NOT fn_puede_ver_alerta(:elsa, :al_panel)
                  AND fn_puede_ver_alerta(:admin, :al_suc) AND fn_puede_ver_alerta(:admin, :al_panel)
                  AND NOT fn_puede_ver_alerta(:admin, 999999),
                      'la alerta de la sucursal la ve quien trabaja en ella; la del panel, solo quien tiene ALERTAS_VER');
SELECT pg_temp.espera_error(format('SELECT fn_atender_alerta(%s, %s)', :beto, :al_suc), 'ALERTAS_VER');
SELECT pg_temp.espera_error(format('SELECT fn_atender_alerta(%s, %s)', :dora, :al_panel), 'ALERTAS_VER');
SELECT fn_atender_alerta(:dora, :al_suc);
SELECT pg_temp.afirma((SELECT atendida_por = :dora FROM alerta WHERE id = :al_suc)
                  AND (SELECT atendida_at IS NULL FROM alerta WHERE id = :al_panel),
                      'la sucursal atiende la suya y la del administrador sigue pendiente');
SELECT fn_atender_alerta(:admin, :al_panel);
SELECT pg_temp.afirma((SELECT atendida_por = :admin FROM alerta WHERE id = :al_panel)
                  AND NOT EXISTS (SELECT 1 FROM v_alertas_pendientes WHERE tipo = 'DEVOLUCION_VENCIDA'),
                      'el administrador atiende la suya');
SELECT pg_temp.espera_error($q$INSERT INTO alerta (tipo, titulo, para_sucursal) VALUES ('PRUEBA', 'Aviso sin sucursal', true)$q$, 'ck_alerta_para_sucursal');

\echo 'S6: cambio por algo más caro (la venta original se pagó con tarjeta)'
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":1}]', '[]', NULL, NULL, NULL, NULL, NULL, 400)$q$, :dora, :t_dva2, :dperf),
                            'El saldo por cambio solo se aplica al ejecutar una devolución aprobada');
SELECT pg_temp.espera_error(format($q$SELECT fn_registrar_venta(%s, %s, '[{"variante_id":%s,"cantidad":1}]', '[{"metodo":"SALDO_CAMBIO","monto":400}]')$q$, :dora, :t_dva2, :dperf),
                            'Método de pago inválido: SALDO_CAMBIO');
SELECT fn_solicitar_devolucion(:dora, :'pc_dva', :vd, 'CAMBIO', 'Prefiere dos perfumes', 'Marta Cliente', '8765-4321',
  format('[{"detalle_id":%s,"cantidad":1,"estado":"BUENO"}]', :vd_cad)::jsonb) AS s6 \gset
SELECT pg_temp.afirma((SELECT tipo = 'CAMBIO' AND monto_total = 540 FROM devolucion WHERE id = :s6)
                  AND (SELECT titulo = 'Cambio por aprobar: factura DVA-00000004, C$ 540.00' FROM v_alertas_pendientes WHERE tipo = 'DEVOLUCION_PENDIENTE' AND (detalle->>'devolucion_id')::bigint = :s6),
                      'cambio: una de las dos cadenas con promoción vale C$540');
SELECT fn_resolver_devolucion(:admin, :s6, true);
SELECT pg_temp.espera_error(format('SELECT fn_ejecutar_devolucion(%s, %s, %s)', :dora, :s6, :t_dva2), 'Para ejecutar un cambio indique lo que se lleva el cliente');
SELECT pg_temp.espera_error(format($q$SELECT fn_ejecutar_devolucion(%s, %s, %s, '[{"variante_id":%s,"cantidad":2}]', '[{"metodo":"EFECTIVO","monto":300}]')$q$, :dora, :s6, :t_dva2, :dperf),
                            'necesita su clave de idempotencia');
SELECT pg_temp.espera_error(format($q$SELECT fn_ejecutar_devolucion(%s, %s, %s, '[{"variante_id":%s,"cantidad":2}]', '[{"metodo":"EFECTIVO","monto":100}]', gen_random_uuid())$q$, :dora, :s6, :t_dva2, :dperf),
                            'Pago insuficiente: total C$ 800.00, pagado C$ 640.00');
SELECT pg_temp.espera_error(format($q$SELECT fn_ejecutar_devolucion(%s, %s, %s, '[{"variante_id":%s,"cantidad":2}]', '[{"metodo":"TARJETA","monto":300,"referencia":"V-1"}]', gen_random_uuid())$q$, :dora, :s6, :t_dva2, :dperf),
                            'exceden el total');
SELECT pg_temp.afirma((SELECT ultimo_numero_devolucion FROM sucursal WHERE id = :dva) = 1 AND (SELECT estado = 'APROBADA' FROM devolucion WHERE id = :s6)
                  AND (SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :dva AND variante_id = :dcad) = 2
                  AND (SELECT ultimo_numero_venta FROM sucursal WHERE id = :dva) = 7,
                      'un cambio que falla no deja nada: ni número, ni inventario, ni venta');
SELECT gen_random_uuid() AS clave6 \gset
SELECT fn_ejecutar_devolucion(:dora, :s6, :t_dva2, format('[{"variante_id":%s,"cantidad":2}]', :dperf)::jsonb, '[{"metodo":"EFECTIVO","monto":300}]', :'clave6', 'Cambio de cadena por perfumes');
SELECT venta_cambio_id AS v6 FROM devolucion WHERE id = :s6 \gset
SELECT pg_temp.afirma((SELECT estado = 'EJECUTADA' AND numero = 'DEV-DVA-000002' AND monto_saldo = 540 AND monto_efectivo = 0 AND monto_transferencia = 0 FROM devolucion WHERE id = :s6)
                  AND (SELECT turno_id = :t_dva2 AND vendedor_id = :dora AND subtotal = 800 AND descuento = 0 AND total = 800 AND promocion_id IS NULL
                              AND cliente_nombre = 'Marta Cliente' AND clave_idempotencia = :'clave6' AND notas = 'Cambio de cadena por perfumes'
                         FROM venta WHERE id = :v6),
                      'el cambio es una venta nueva (sin promoción) y toma el siguiente número de devolución, sin saltos');
SELECT pg_temp.afirma((SELECT count(*) = 3
                              AND sum(vp.monto) FILTER (WHERE m.codigo = 'SALDO_CAMBIO') = 540
                              AND sum(vp.monto) FILTER (WHERE m.es_efectivo AND NOT vp.es_vuelto) = 300
                              AND sum(vp.monto) FILTER (WHERE vp.es_vuelto) = -40
                         FROM venta_pago vp JOIN metodo_pago m ON m.id = vp.metodo_pago_id WHERE vp.venta_id = :v6),
                      'lo devuelto entra como "saldo por cambio" (C$540) y el cliente paga la diferencia: C$260 (dio 300, vuelto 40)');
SELECT pg_temp.afirma((SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :dva AND variante_id = :dcad) = 3
                  AND (SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :dva AND variante_id = :dperf) = 4,
                      'vuelve la cadena y salen los dos perfumes');
SELECT pg_temp.afirma((SELECT monto_esperado FROM fn_resumen_turno(:t_dva2) WHERE metodo = 'Efectivo' AND moneda = 'NIO') = 4993.33
                  AND NOT EXISTS (SELECT 1 FROM fn_resumen_turno(:t_dva2) WHERE metodo <> 'Efectivo'),
                      'el saldo por cambio no es dinero: al arqueo solo entran los C$260 que pagó');
SELECT pg_temp.espera_error(format('SELECT fn_anular_venta(%s, %s, %L)', :admin, :v6, 'Se equivocaron de perfume'), 'nació del cambio DEV-DVA-000002: no se anula');
SELECT pg_temp.espera_error(format($q$SELECT fn_ejecutar_devolucion(%s, %s, %s, '[{"variante_id":%s,"cantidad":2}]', '[{"metodo":"EFECTIVO","monto":300}]', %L)$q$, :dora, :s6, :t_dva2, :dperf, :'clave6'),
                            'ya se ejecutó (DEV-DVA-000002)');

\echo 'S7: cambio por algo más barato (venta pagada mitad en efectivo, mitad por transferencia)'
SELECT fn_solicitar_devolucion(:dora, :'pc_dva', :vf, 'CAMBIO', 'La quiere cambiar por un perfume', 'Nora Cliente', '8111-2222',
  format('[{"detalle_id":%s,"cantidad":1,"estado":"BUENO"}]', :vf_cad)::jsonb) AS s7 \gset
SELECT fn_resolver_devolucion(:admin, :s7, true);
SELECT pg_temp.espera_error(format($q$SELECT fn_ejecutar_devolucion(%s, %s, %s, '[{"variante_id":%s,"cantidad":1}]', '[]', %L)$q$, :dora, :s7, :t_dva2, :dperf, :'clave6'),
                            'Esa clave de idempotencia ya es de otra venta');
SELECT fn_ejecutar_devolucion(:dora, :s7, :t_dva2, format('[{"variante_id":%s,"cantidad":1}]', :dperf)::jsonb, '[]', gen_random_uuid());
SELECT venta_cambio_id AS v7 FROM devolucion WHERE id = :s7 \gset
SELECT pg_temp.afirma((SELECT numero = 'DEV-DVA-000003' AND monto_total = 600 AND monto_saldo = 400 AND monto_efectivo = 100 AND monto_transferencia = 100 FROM devolucion WHERE id = :s7)
                  AND (SELECT total = 400 FROM venta WHERE id = :v7)
                  AND (SELECT count(*) = 1 AND bool_and(m.codigo = 'SALDO_CAMBIO' AND vp.monto = 400) FROM venta_pago vp JOIN metodo_pago m ON m.id = vp.metodo_pago_id WHERE vp.venta_id = :v7),
                      'lo nuevo cuesta menos: C$400 de saldo y los C$200 que sobran se devuelven como se pagó (100 en efectivo, 100 por transferencia)');
SELECT pg_temp.afirma((SELECT monto_esperado FROM fn_resumen_turno(:t_dva2) WHERE metodo = 'Efectivo' AND moneda = 'NIO') = 4893.33
                  AND (SELECT titulo = 'Devolución DEV-DVA-000003: falta transferirle al cliente C$ 100.00' FROM v_alertas_pendientes
                        WHERE tipo = 'DEVOLUCION_TRANSFERENCIA' AND (detalle->>'devolucion_id')::bigint = :s7),
                      'los C$100 en efectivo salen de la caja y los otros C$100 quedan para transferir');

\echo 'Cierre de la caja con devoluciones y cambios'
SELECT pg_temp.espera_error(format($q$SELECT fn_cerrar_turno(%s, %s, '[{"moneda":"NIO","valor":1,"cantidad":4893}]', '[{"metodo":"SALDO_CAMBIO","monto":940}]')$q$, :dora, :t_dva2),
                            'Método de pago o monto inválido en el arqueo: SALDO_CAMBIO');
SELECT fn_cerrar_turno(:dora, :t_dva2, '[{"moneda":"NIO","valor":1,"cantidad":4893}]') AS ticket_dva2 \gset
SELECT pg_temp.afirma((:'ticket_dva2'::jsonb->>'cerrado')::boolean
                  AND (SELECT count(*) = 1 AND bool_and(m.es_efectivo AND d.moneda = 'NIO' AND d.monto_esperado = 4893.33 AND d.diferencia = -0.33)
                         FROM cierre_caja_detalle d JOIN metodo_pago m ON m.id = d.metodo_pago_id WHERE d.turno_id = :t_dva2),
                      'la caja cuadra contando lo que salió por las devoluciones (faltan 33 centavos: no hay monedas para eso)');
SELECT pg_temp.afirma(NOT (:'ticket_dva2'::jsonb ?| ARRAY['devoluciones', 'devuelto_efectivo', 'saldo_cambio', 'cobros', 'total_vendido']),
                      'arqueo ciego: el ticket de quien cierra no trae las devoluciones ni el efectivo que salió por ellas');
SELECT pg_temp.afirma((SELECT (t->>'ventas')::integer = 2 AND (t->>'total_vendido')::numeric = 1200 AND (t->>'saldo_cambio')::numeric = 940
                              AND (t->>'devoluciones')::integer = 3 AND (t->>'devuelto_efectivo')::numeric = 366.67
                              AND jsonb_array_length(t->'cobros') = 1 AND (t->'cobros'->0->>'monto')::numeric = 260
                         FROM fn_ticket_cierre(:t_dva2, true) t),
                      'el ticket completo sí: 3 devoluciones, C$366.67 devueltos en efectivo, y lo vendido = cobrado (260) + saldo por cambio (940)');

\echo 'S8: se devuelve algo comprado en un cambio'
SELECT pg_temp.afirma(fn_proporcion_efectivo(:v6) = 0.325,
                      'la venta del cambio se pagó con C$260 en efectivo y C$540 de saldo de una venta con tarjeta: 32.5 % en efectivo');
SELECT id AS v6_perf FROM venta_detalle WHERE venta_id = :v6 \gset
SELECT fn_solicitar_devolucion(:admin, NULL, :v6, 'DEVOLUCION', 'Uno de los perfumes del cambio no le gustó', 'Marta Cliente', '8765-4321',
  format('[{"detalle_id":%s,"cantidad":1,"estado":"BUENO"}]', :v6_perf)::jsonb) AS s8 \gset
SELECT pg_temp.afirma((SELECT sucursal_solicitud_id = :dva AND monto_total = 400 FROM devolucion WHERE id = :s8),
                      'el administrador, sin equipo registrado, la solicita en la sucursal de la venta');
SELECT pg_temp.espera_error(format($q$SELECT fn_solicitar_devolucion(%s, NULL, %s, 'DEVOLUCION', 'Otro perfume del cambio', 'Marta Cliente', '8765-4321', '[{"detalle_id":%s,"cantidad":1,"estado":"BUENO"}]', %s)$q$,
                                   :admin, :v6, :v6_perf, :bod), 'no existe o no es de venta');
SELECT fn_resolver_devolucion(:admin, :s8, true);
SELECT fn_abrir_turno(:dora, :caja_dva, 4893, 0) AS t_dva3 \gset
SELECT fn_ejecutar_devolucion(:dora, :s8, :t_dva3);
SELECT pg_temp.afirma((SELECT numero = 'DEV-DVA-000004' AND monto_efectivo = 130 AND monto_transferencia = 270 FROM devolucion WHERE id = :s8),
                      'se reembolsa siguiendo el dinero hasta la venta de origen: C$130 en efectivo y C$270 por transferencia');

\echo 'Reportes e impresión'
SELECT pg_temp.afirma((SELECT count(*) FROM fn_devoluciones_reporte(:admin, :'hoy', :'hoy', :dva)) = 5
                  AND (SELECT count(*) FROM fn_devoluciones_reporte(:admin, :'hoy', :'hoy', :dvb)) = 0
                  AND (SELECT count(*) = 1 AND bool_and(x = :s1) FROM fn_devoluciones_reporte(:admin, :'hoy', :'hoy', :dvb, 'CAJA') x)
                  AND (SELECT count(*) FROM fn_devoluciones_reporte(:admin, :'hoy', :'hoy', :dva, 'CAJA')) = 4
                  AND (SELECT count(*) FROM fn_devoluciones_reporte(:admin, :'hoy', :'hoy', :dvb, 'AMBAS')) = 1
                  AND (SELECT count(*) FROM fn_devoluciones_reporte(:admin, :'hoy'::date - 30, :'hoy'::date - 1, :dva)) = 0,
                      'reportes: la devolución cuenta el día en que se ejecutó; para las ventas, en la sucursal de la venta original; para la caja, donde se ejecutó');
SELECT pg_temp.afirma((SELECT count(*) = 3 AND bool_and(x IN (:s2, :s6, :s7)) FROM fn_devoluciones_reporte(:lina, :'hoy', :'hoy', NULL, 'AMBAS') x)
                  AND (SELECT count(*) FROM fn_devoluciones_reporte(:elsa, :'hoy', :'hoy', NULL, 'AMBAS')) = 5
                  AND (SELECT count(*) FROM fn_devoluciones_reporte(:rita, :'hoy', :'hoy', NULL, 'AMBAS')) = 0
                  AND (SELECT count(*) FROM fn_devoluciones_reporte(:dora, :'hoy', :'hoy', NULL, 'AMBAS')) = 0,
                      'reportes: sin CAJA_VER_DIFERENCIAS no entran las ejecutadas en un turno abierto; cada quien, sus sucursales; sin REPORTES_VER, ninguna');
SELECT pg_temp.afirma((SELECT count(*) = 1 AND bool_and(cantidad = -1 AND venta_neta = -360 AND costo = -150 AND margen = -210 AND subtotal_linea = -400
                                                       AND vendedor_id = :dora AND sucursal_id = :dva AND dia = :'hoy' AND venta_id = :va AND detalle_id = :va_perf
                                                       AND devolucion_numero = 'DEV-DVB-000001' AND estado_producto = 'BUENO')
                         FROM v_devoluciones_linea WHERE devolucion_id = :s1)
                  AND (SELECT sum(venta_neta) FROM (SELECT venta_neta FROM v_ventas_linea WHERE venta_id = :va
                                                    UNION ALL SELECT venta_neta FROM v_devoluciones_linea WHERE venta_id = :va) x) = 540,
                      'venta neta: la devolución resta con signo negativo, a la vendedora y a la sucursal de la venta original');
SELECT pg_temp.espera_error(format('SELECT fn_registrar_impresion_devolucion(%s, 999999)', :admin), 'La devolución 999999 no existe');
SELECT pg_temp.afirma(fn_registrar_impresion_devolucion(:beto, :s1) = 1, 'ticket de devolución: la primera impresión es el original');
SELECT pg_temp.afirma(fn_registrar_impresion_devolucion(:dora, :s1) = 2 AND fn_registrar_impresion_devolucion(:admin, :s1) = 3,
                      'ticket de devolución: las siguientes son copia (la imprime también la sucursal que la solicitó)');
SELECT pg_temp.espera_error(format('SELECT fn_registrar_impresion_devolucion(%s, %s)', :carlos, :s1), 'No puede imprimir el ticket de la devolución');
SELECT fn_solicitar_devolucion(:dora, :'pc_dva', :ve, 'DEVOLUCION', 'La cadena le queda corta', 'Ana Cliente', '8222-3333',
  format('[{"detalle_id":%s,"cantidad":1,"estado":"BUENO"}]', :ve_cad)::jsonb) AS s9 \gset
SELECT pg_temp.espera_error(format('SELECT fn_registrar_impresion_devolucion(%s, %s)', :dora, :s9), 'todavía no se ejecuta: el ticket sale al ejecutarla');
SELECT pg_temp.espera_error(format('SELECT fn_registrar_transferencia_devolucion(%s, %s, %L)', :admin, :s9, 'BAC-1'), 'todavía no se ejecuta');
SELECT pg_temp.afirma(NOT fn_puede_ver_devolucion(:beto, :s9) AND fn_puede_ver_devolucion(:elsa, :s9) AND fn_puede_ver_devolucion(:admin, :s9),
                      'una solicitud pendiente la ven su sucursal y el administrador');
SELECT pg_temp.espera_error(format('INSERT INTO ticket_impresion (venta_id, devolucion_id, usuario_id) VALUES (%s, %s, %s)', :va, :s1, :admin), 'ck_impresion_de');
SELECT fn_cierre_forzado(:admin, :t_dvb, 'Cierre de la sucursal B de las pruebas de devoluciones');
SELECT fn_cierre_forzado(:admin, :t_dva3, 'Cierre de la sucursal A de las pruebas de devoluciones');
SELECT pg_temp.afirma((SELECT count(*) FROM fn_devoluciones_reporte(:lina, :'hoy', :'hoy', NULL, 'AMBAS')) = 5, 'reportes: cerrados los turnos, sus devoluciones ya entran para todos');

\echo '\n=== 25. NUMERACIÓN DE FACTURAS Y DE DEVOLUCIONES: CORRELATIVO POR SUCURSAL, SIN SALTOS'
SELECT pg_temp.afirma((SELECT sum(ultimo_numero_devolucion) FROM sucursal) = 5
                  AND NOT EXISTS (
                        SELECT 1 FROM sucursal s
                         WHERE (SELECT count(*) FROM devolucion d WHERE d.sucursal_id = s.id) <> s.ultimo_numero_devolucion
                            OR EXISTS (SELECT 1 FROM generate_series(1, s.ultimo_numero_devolucion) n
                                        WHERE NOT EXISTS (SELECT 1 FROM devolucion d
                                                           WHERE d.sucursal_id = s.id
                                                             AND d.numero = 'DEV-' || s.codigo || '-' || lpad(n::text, 6, '0'))))
                  AND NOT EXISTS (SELECT 1 FROM devolucion WHERE estado <> 'EJECUTADA' AND numero IS NOT NULL),
                  'en cada sucursal las devoluciones van del 1 al último número, sin saltos (rechazadas, canceladas y fallidas no toman número)');
-- Después de todas las ventas de arriba (completadas, anuladas, rechazadas y repetidas con la misma clave)
SELECT pg_temp.afirma((SELECT sum(ultimo_numero_venta) FROM sucursal) > 0
                  AND NOT EXISTS (
                        SELECT 1 FROM sucursal s
                         WHERE (SELECT count(*) FROM venta v WHERE v.sucursal_id = s.id) <> s.ultimo_numero_venta
                            OR EXISTS (SELECT 1 FROM generate_series(1, s.ultimo_numero_venta) n
                                        WHERE NOT EXISTS (SELECT 1 FROM venta v
                                                           WHERE v.sucursal_id = s.id
                                                             AND v.numero = s.codigo || '-' || lpad(n::text, 8, '0')))),
                  'en cada sucursal las facturas van del 1 al último número, sin saltos (las anuladas conservan el suyo)');

\echo '\n*** TODAS LAS PRUEBAS PASARON ***'
