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
SELECT fn_registrar_venta(:carlos, :turno_lbr, format('[{"variante_id":%s,"cantidad":1}]', :nei)::jsonb,
  '[{"metodo":"EFECTIVO","monto":520}]', NULL, NULL, NULL, NULL, 'a1b2c3d4-0000-4000-8000-000000000001') AS vi1 \gset
SELECT fn_registrar_venta(:carlos, :turno_lbr, format('[{"variante_id":%s,"cantidad":1}]', :nei)::jsonb,
  '[{"metodo":"EFECTIVO","monto":520}]', NULL, NULL, NULL, NULL, 'a1b2c3d4-0000-4000-8000-000000000001') AS vi2 \gset
SELECT pg_temp.afirma(:vi1 = :vi2, 'el doble clic devuelve la misma venta');
SELECT pg_temp.afirma((SELECT count(*) FROM venta) = :ventas_antes + 1, 'solo se creó una venta');
SELECT pg_temp.afirma((SELECT cantidad FROM stock_sucursal WHERE sucursal_id = :lbr AND variante_id = :nei) = :lbr_nei - 1, 'el stock bajó una sola vez');

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
SELECT pg_temp.espera_error(format($q$SELECT fn_cerrar_turno(%s, %s, %L, %L, 999999)$q$, :carlos, :turno_lbr, :'conteo_corto', format('[{"metodo":"TARJETA","monto":%s}]', :lbr_tarjeta)), 'más efectivo del contado');
SELECT pg_temp.espera_error(format($q$SELECT fn_cerrar_turno(%s, %s, %L, %L, 0)$q$, :carlos, :turno_lbr, :'conteo_corto', format('[{"metodo":"TARJETA","monto":%s}]', :lbr_tarjeta)), 'escriba una justificación');
SELECT pg_temp.afirma((SELECT estado FROM turno_caja WHERE id = :turno_lbr) = 'ABIERTO' AND NOT EXISTS (SELECT 1 FROM cierre_denominacion WHERE turno_id = :turno_lbr), 'sin justificación no se cierra ni se guarda nada');
SELECT fn_cerrar_turno(:carlos, :turno_lbr, :'conteo_corto', format('[{"metodo":"TARJETA","monto":%s}]', :lbr_tarjeta)::jsonb,
                       floor(:lbr_nio) - 800, 0, 'Se pagó al técnico del aire acondicionado sin registrar el egreso') AS ticket2 \gset
SELECT pg_temp.afirma((:'ticket2'::jsonb->>'fondo_siguiente_nio')::numeric = 300, 'queda C$300 de fondo en Las Brisas');
SELECT pg_temp.afirma(EXISTS (SELECT 1 FROM v_alertas_pendientes WHERE tipo = 'CAJA_DIFERENCIA' AND (detalle->>'turno_id')::bigint = :turno_lbr
                               AND (detalle->>'diferencia_total_nio')::numeric <= -500), 'diferencia mayor a C$100: alerta al admin con la justificación');
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

\echo '\n*** TODAS LAS PRUEBAS PASARON ***'
