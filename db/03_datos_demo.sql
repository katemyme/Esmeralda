-- =====================================================================
--  ESMERALDA EXPERIENCE — Datos de DEMOSTRACIÓN (solo desarrollo / pruebas)
--  NO ejecutar en producción. Precios ilustrativos.
-- =====================================================================
BEGIN;

SELECT set_config('app.usuario_id', (SELECT id::text FROM usuario WHERE username = 'admin'), true);

-- Usuarios de prueba (contraseña de todos: Demo#2026) — creados con la función del panel
SELECT fn_crear_usuario(
  (SELECT id FROM usuario WHERE username = 'admin'),
  'María López', 'maria.lopez', crypt('Demo#2026', gen_salt('bf', 10)), 'ENCARGADO',
  ARRAY[(SELECT id FROM sucursal WHERE codigo = 'LAM')], 'maria@example.com');

SELECT fn_crear_usuario(
  (SELECT id FROM usuario WHERE username = 'admin'),
  'Ana Martínez', 'ana.martinez', crypt('Demo#2026', gen_salt('bf', 10)), 'VENDEDOR',
  ARRAY[(SELECT id FROM sucursal WHERE codigo = 'LAM')]);

SELECT fn_crear_usuario(
  (SELECT id FROM usuario WHERE username = 'admin'),
  'Carlos Ruiz', 'carlos.ruiz', crypt('Demo#2026', gen_salt('bf', 10)), 'VENDEDOR',
  ARRAY[(SELECT id FROM sucursal WHERE codigo = 'LBR')]);

-- Tipo de cambio
INSERT INTO tipo_cambio (fecha, usd_a_nio, usuario_id)
VALUES ((now() AT TIME ZONE 'America/Managua')::date - 60, 36.6243, fn_usuario_actual());

-- Proveedores
SELECT fn_crear_proveedor((SELECT id FROM usuario WHERE username = 'admin'), 'Body Jewelry Supply', 'Estados Unidos', 'USD');
SELECT fn_crear_proveedor((SELECT id FROM usuario WHERE username = 'admin'), 'Distribuidora Local', 'Nicaragua', 'NIO');

-- Productos y variantes (piezas y artículos con stock)
WITH p AS (
  INSERT INTO producto (categoria_id, nombre, tipo) VALUES
    ((SELECT id FROM categoria WHERE nombre = 'Piercing titanio'),  'Labret rosca interna',      'PRODUCTO'),
    ((SELECT id FROM categoria WHERE nombre = 'Piercing acero'),    'Aro segmento',              'PRODUCTO'),
    ((SELECT id FROM categoria WHERE nombre = 'Piercing acero'),    'Labret con piedra',         'PRODUCTO'),
    ((SELECT id FROM categoria WHERE nombre = 'Cuidado posterior'), 'NeilMed Piercing Aftercare','PRODUCTO'),
    ((SELECT id FROM categoria WHERE nombre = 'Joyería plata 925'), 'Cadena cartier',            'PRODUCTO')
  RETURNING id, nombre
)
INSERT INTO variante (producto_id, sku, codigo_barras, nombre, atributos, precio_venta, costo, gama_id)
SELECT p.id, v.sku, v.cb, v.nombre, v.attr::jsonb, v.precio, v.costo, g.id
  FROM p JOIN (VALUES
    ('Labret rosca interna',       'TIT-LAB-16-6', '7501000000011', 'Titanio F-136 · 16G · 6 mm', '{"material":"titanio","calibre":"16G","largo_mm":6}', 650.00, 220.00, 'Titanio'),
    ('Labret rosca interna',       'TIT-LAB-16-8', '7501000000028', 'Titanio F-136 · 16G · 8 mm', '{"material":"titanio","calibre":"16G","largo_mm":8}', 650.00, 220.00, 'Titanio'),
    ('Aro segmento',               'ACE-ARO-16-8', '7501000000035', 'Acero · 16G · 8 mm',     '{"material":"acero","calibre":"16G","diametro_mm":8}', 250.00,  60.00, 'Acero clásica'),
    ('Labret con piedra',          'ACE-LAB-PDR',  '7501000000059', 'Acero · 16G · piedra',   '{"material":"acero","calibre":"16G"}',             350.00,  90.00, 'Acero de lujo'),
    ('NeilMed Piercing Aftercare', 'NEI-AFT-177',  '7050000000017', '177 ml',                 '{"presentacion":"177 ml"}',                        520.00, 310.00, NULL),
    ('Cadena cartier',             'PLA-CAD-45',   '7501000000042', 'Plata 925 · 45 cm',      '{"material":"plata 925","largo_cm":45}',          1200.00, 480.00, NULL)
  ) AS v(producto, sku, cb, nombre, attr, precio, costo, gama) ON v.producto = p.nombre
  LEFT JOIN gama g ON g.nombre = v.gama;

-- Perforaciones (precios ilustrativos): cada una crea "solo servicio" y "con pieza"
SELECT fn_crear_perforacion((SELECT id FROM usuario WHERE username = 'admin'), 'LOB',  'Lóbulo',       300, 1::smallint);
SELECT fn_crear_perforacion((SELECT id FROM usuario WHERE username = 'admin'), 'HLX',  'Hélix',        350, 1::smallint);
SELECT fn_crear_perforacion((SELECT id FROM usuario WHERE username = 'admin'), 'LOBP', 'Lóbulos (par)', 500, 2::smallint);
SELECT fn_crear_perforacion((SELECT id FROM usuario WHERE username = 'admin'), 'TRG',  'Tragus',       400, 1::smallint);

-- Tabla perforación × gama (acero). Tragus queda sin tabla a propósito (para las pruebas).
SELECT fn_set_precio_gama((SELECT id FROM usuario WHERE username = 'admin'),
                          (SELECT id FROM perforacion WHERE codigo = t.perf), (SELECT id FROM gama WHERE nombre = t.gama), t.precio)
  FROM (VALUES ('LOB','Acero clásica',350), ('LOB','Acero de lujo',450),
               ('HLX','Acero clásica',450), ('HLX','Acero de lujo',550),
               ('LOBP','Acero clásica',600), ('LOBP','Acero de lujo',800)) AS t(perf, gama, precio);

-- Lóbulo: solo acero clásica o titanio
SELECT fn_set_pieza_permitida((SELECT id FROM usuario WHERE username = 'admin'),
                              (SELECT id FROM perforacion WHERE codigo = 'LOB'), (SELECT id FROM gama WHERE nombre = g), NULL, NULL, true)
  FROM unnest(ARRAY['Acero clásica','Titanio']) AS g;

-- Excepción: hélix con el labret de titanio 8 mm a C$900 (en vez de 350 + 650)
SELECT fn_set_precio_especial((SELECT id FROM usuario WHERE username = 'admin'),
                              (SELECT id FROM perforacion WHERE codigo = 'HLX'),
                              (SELECT id FROM variante WHERE sku = 'TIT-LAB-16-8'), NULL, 900, 'Promoción de lanzamiento');

-- Stock inicial: toda la mercadería entra por la bodega central...
SELECT fn_movimiento_inventario((SELECT id FROM usuario WHERE username = 'admin'),
                                (SELECT id FROM sucursal WHERE codigo = 'BOD'), va.id, 'ENTRADA', q.cant,
                                'Inventario inicial')
  FROM (VALUES ('TIT-LAB-16-6',40), ('TIT-LAB-16-8',25), ('ACE-ARO-16-8',60),
               ('NEI-AFT-177',24),  ('PLA-CAD-45',10), ('ACE-LAB-PDR',20)) AS q(sku, cant)
  JOIN variante va ON va.sku = q.sku;

-- ...y se reparte a las sucursales con envíos (enviar → recibir)
DO $$
DECLARE
  v_admin bigint := (SELECT id FROM usuario WHERE username = 'admin');
  v_bod integer := (SELECT id FROM sucursal WHERE codigo = 'BOD');
  v_suc record; v_env bigint; r record;
BEGIN
  FOR v_suc IN SELECT id, codigo FROM sucursal WHERE tipo = 'SUCURSAL' ORDER BY id LOOP
    v_env := fn_crear_envio(v_admin, v_bod, v_suc.id, 'Reparto inicial');
    FOR r IN SELECT va.id, q.cant
               FROM (VALUES ('LAM','TIT-LAB-16-6',20), ('LAM','TIT-LAB-16-8',15), ('LAM','ACE-ARO-16-8',30),
                            ('LAM','NEI-AFT-177',12),  ('LAM','PLA-CAD-45',5),   ('LAM','ACE-LAB-PDR',10),
                            ('LBR','TIT-LAB-16-6',10), ('LBR','ACE-ARO-16-8',20), ('LBR','NEI-AFT-177',6),
                            ('LBR','PLA-CAD-45',3)) AS q(suc, sku, cant)
               JOIN variante va ON va.sku = q.sku
              WHERE q.suc = v_suc.codigo
    LOOP
      PERFORM fn_envio_set_linea(v_admin, v_env, r.id, r.cant);
    END LOOP;
    PERFORM fn_enviar(v_admin, v_env);
    PERFORM fn_recibir_envio(v_admin, v_env,
              (SELECT jsonb_agg(jsonb_build_object('variante_id', variante_id, 'cantidad', cantidad_enviada))
                 FROM envio_detalle WHERE envio_id = v_env));
  END LOOP;
END $$;

-- Promociones de ejemplo
SELECT fn_set_promocion_activa((SELECT id FROM usuario WHERE username = 'admin'),
         fn_guardar_promocion((SELECT id FROM usuario WHERE username = 'admin'), NULL, 'Promo 10 %', 'PORCENTAJE', 10), true);
SELECT fn_set_promocion_activa((SELECT id FROM usuario WHERE username = 'admin'),
         fn_guardar_promocion((SELECT id FROM usuario WHERE username = 'admin'), NULL, 'Aniversario C$100', 'MONTO', 100, 1000,
                              ((now() AT TIME ZONE 'America/Managua')::date + 30),
                              ((now() AT TIME ZONE 'America/Managua')::date + 37),
                              'C$100 menos en compras desde C$1,000, la semana del aniversario'), true);
SELECT fn_guardar_promocion((SELECT id FROM usuario WHERE username = 'admin'), NULL, 'Black Friday 20 %', 'PORCENTAJE', 20);

UPDATE stock_sucursal SET stock_minimo = 5
 WHERE sucursal_id IN (SELECT id FROM sucursal WHERE tipo = 'SUCURSAL');

COMMIT;
