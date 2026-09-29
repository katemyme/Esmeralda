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

-- Productos y variantes
WITH p AS (
  INSERT INTO producto (categoria_id, nombre, tipo) VALUES
    ((SELECT id FROM categoria WHERE nombre = 'Perforaciones'),     'Perforación lóbulo',        'SERVICIO'),
    ((SELECT id FROM categoria WHERE nombre = 'Perforaciones'),     'Perforación hélix',         'SERVICIO'),
    ((SELECT id FROM categoria WHERE nombre = 'Piercing titanio'),  'Labret rosca interna',      'PRODUCTO'),
    ((SELECT id FROM categoria WHERE nombre = 'Piercing acero'),    'Aro segmento',              'PRODUCTO'),
    ((SELECT id FROM categoria WHERE nombre = 'Cuidado posterior'), 'NeilMed Piercing Aftercare','PRODUCTO'),
    ((SELECT id FROM categoria WHERE nombre = 'Joyería plata 925'), 'Cadena cartier',            'PRODUCTO')
  RETURNING id, nombre
)
INSERT INTO variante (producto_id, sku, codigo_barras, nombre, atributos, precio_venta, costo)
SELECT p.id, v.sku, v.cb, v.nombre, v.attr::jsonb, v.precio, v.costo
  FROM p JOIN (VALUES
    ('Perforación lóbulo',         'SRV-LOB',      NULL,            'Única',                  '{}',                                              300.00,   0.00),
    ('Perforación hélix',          'SRV-HLX',      NULL,            'Única',                  '{}',                                              450.00,   0.00),
    ('Labret rosca interna',       'TIT-LAB-16-6', '7501000000011', 'Titanio F-136 · 16G · 6 mm', '{"material":"titanio","calibre":"16G","largo_mm":6}', 650.00, 220.00),
    ('Labret rosca interna',       'TIT-LAB-16-8', '7501000000028', 'Titanio F-136 · 16G · 8 mm', '{"material":"titanio","calibre":"16G","largo_mm":8}', 650.00, 220.00),
    ('Aro segmento',               'ACE-ARO-16-8', '7501000000035', 'Acero · 16G · 8 mm',     '{"material":"acero","calibre":"16G","diametro_mm":8}', 250.00,  60.00),
    ('NeilMed Piercing Aftercare', 'NEI-AFT-177',  '7050000000017', '177 ml',                 '{"presentacion":"177 ml"}',                        520.00, 310.00),
    ('Cadena cartier',             'PLA-CAD-45',   '7501000000042', 'Plata 925 · 45 cm',      '{"material":"plata 925","largo_cm":45}',          1200.00, 480.00)
  ) AS v(producto, sku, cb, nombre, attr, precio, costo) ON v.producto = p.nombre;

-- Stock inicial: toda la mercadería entra por la bodega central...
SELECT fn_movimiento_inventario((SELECT id FROM usuario WHERE username = 'admin'),
                                (SELECT id FROM sucursal WHERE codigo = 'BOD'), va.id, 'ENTRADA', q.cant,
                                'Inventario inicial')
  FROM (VALUES ('TIT-LAB-16-6',40), ('TIT-LAB-16-8',25), ('ACE-ARO-16-8',60),
               ('NEI-AFT-177',24),  ('PLA-CAD-45',10)) AS q(sku, cant)
  JOIN variante va ON va.sku = q.sku;

-- ...y se reparte a las sucursales
SELECT fn_trasladar_stock((SELECT id FROM usuario WHERE username = 'admin'),
                          (SELECT id FROM sucursal WHERE codigo = 'BOD'), s.id, va.id, q.cant, 'Reparto inicial')
  FROM (VALUES ('LAM','TIT-LAB-16-6',20), ('LAM','TIT-LAB-16-8',15), ('LAM','ACE-ARO-16-8',30),
               ('LAM','NEI-AFT-177',12),  ('LAM','PLA-CAD-45',5),
               ('LBR','TIT-LAB-16-6',10), ('LBR','ACE-ARO-16-8',20), ('LBR','NEI-AFT-177',6),
               ('LBR','PLA-CAD-45',3)) AS q(suc, sku, cant)
  JOIN sucursal s  ON s.codigo = q.suc
  JOIN variante va ON va.sku = q.sku;

UPDATE stock_sucursal SET stock_minimo = 5
 WHERE sucursal_id IN (SELECT id FROM sucursal WHERE tipo = 'SUCURSAL');

COMMIT;
