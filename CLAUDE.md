# Sistema Esmeralda — guía para Claude Code

Sistema web de inventario, ventas (POS) y caja para **Esmeralda Experience** (estudio de perforaciones
y joyería): sucursales Multicentro Las Américas (`LAM`) y Multicentro Las Brisas (`LBR`) y una
bodega central (`BOD`, en casa del dueño). Todo el texto para el usuario va en **español**.

## Reglas de trabajo

- **Nunca** agregar a Claude como colaborador: sin `Co-Authored-By`, sin `Claude-Session`, sin
  "Generated with Claude Code" en commits ni PRs (ya configurado en `.claude/settings.json`).
- Avanzar **paso a paso**: cada paso con sus pruebas, todas en verde, y un commit descriptivo en español.
- No subir a GitHub hasta que el dueño lo pida.
- Moneda base: córdobas (NIO). Pagos en NIO o USD. Fechas en `timestamptz`; reportes en `America/Managua`,
  semana de lunes a domingo.

## Estado actual

_Actualizado el 2026-10-08._

- **Terminado y aprobado por el dueño:** esquema de base de datos v1.1 y los pasos **B1**, **B2** (etiqueta
  `guardado-b2`), **B3**, **B4**, **B5**, **B6** y **B7** del backend. Con B5 se hizo también todo lo que había quedado fuera de
  B3 y B4: sucursales y cajas, roles nuevos, desbloqueo, mínimo de parámetros, bitácora, fotos, historial de
  precios, búsqueda para la venta, existencias y la carga inicial desde Excel. El dueño aprobó B5 el 2026-10-06
  (reglas para desactivar sucursales y eliminar roles, visibilidad por sucursal, fotos públicas con nombre al
  azar, carga inicial que no duplica; el aviso de exceljs se queda así) con dos ajustes ya hechos: la carga
  inicial actualiza el precio de los productos que ya existen, y pruebas de que las facturas no dejan saltos.
- **B6 (POS y caja) aprobado el 2026-10-07:** el dueño aprobó las siete decisiones (están en «Decisiones de
  negocio clave») y lo reportado, y respondió las preguntas abiertas: la carga inicial actualiza también el precio
  de solo servicio de las perforaciones que ya existen (hecho); los envíos se quedan con su SEQUENCE (ahí los
  saltos no importan); el RUC y la leyenda del ticket quedan vacíos y él los llena en el panel. Pidió además un
  control del tipo de cambio (variación máxima con confirmación y rango del primero), ya hecho.
- **B7 (reportes, exportación a Excel y PDF, tickets en PDF y tareas programadas) aprobado el 2026-10-08**, con
  las decisiones tomadas al programarlo. La **foto mensual del inventario se queda** (el dueño lo confirmó).
- **Agregado el 2026-10-08, a pedido del dueño:** los reportes de compras por proveedor y de piezas consumidas en
  paquetes (solo con `REPORTES_COSTOS`) y el historial del tipo de cambio (`GET /api/tipo-cambio/historial`).
- **B8 (devoluciones y cambios de ventas de turnos ya cerrados) aprobado el 2026-10-08**, con las decisiones
  tomadas al programarlo (están en «Decisiones de negocio clave», «Devoluciones y cambios»). El dueño confirmó
  que en un **cambio por algo más barato** lo que sobra sigue la forma de pago de la factura original, igual que
  el reembolso. Con B8 el backend queda completo: etiqueta `backend-completo` y respaldo en
  `C:\Respaldos\esmeralda-backend-completo.bundle` (los dos actualizados el 2026-10-08 con el ajuste que sigue).
- **Ajuste pedido al aprobar B8, ya hecho (2026-10-08):** la devolución aprobada que vence deja dos alertas
  `DEVOLUCION_VENCIDA`, una en el panel del administrador y otra para la sucursal que la solicitó. Para eso las
  alertas tienen ahora la casilla `para_sucursal` y la ruta `GET /api/alertas/sucursal` (ver «Convenciones del
  backend», Panel).
- **Backend para F1, terminado (2026-10-08):** acceso desde el celular (sin equipo registrado) con la venta, y
  cambio rápido de vendedora con PIN. El dueño aprobó los diseños ese día (están en «Decisiones de negocio
  clave», «Celular y PIN»). La etiqueta `backend-completo` y el respaldo se movieron a este punto.
- **F1 del frontend aprobada por el dueño el 2026-10-08** (`frontend/`, la base). La probó en su computadora y
  en su celular por el túnel de Cloudflare.
- **Cambio de equipo (dueño, 2026-10-08):** de momento no habrá tablet. El equipo de la sucursal será un
  **celular Android del negocio** (el del dueño), registrado como equipo («Celular del negocio»): tiene todo,
  con PIN y bloqueo, e imprime por WebUSB con un adaptador OTG. Por eso las pantallas de caja y venta se
  diseñan **primero para celular**. La impresora la prueba más adelante.
- **F2a aprobada en plan (2026-10-08), en dos partes.** Decisiones del dueño: las dos sucursales operan desde
  el inicio, cada una con su celular del negocio registrado y su Xprinter XP-T80A por USB (cada uno abre y
  cierra solo su caja; su cola solo muestra sus tickets); también debe funcionar una **PC de caja con Windows**
  (driver de Xprinter, Chrome con `--kiosk-printing`, gaveta por el driver); la cola imprime aunque la pantalla
  esté bloqueada mientras el equipo esté abierto; botón «No imprimir» en la cola anotando quién, y al cerrar el
  turno lo que quede en la cola se marca solo como «no impreso»; Wake Lock en el equipo abierto.
- **Terminada, pendiente de su revisión: F2a parte 1 (caja y consulta de precios)**, hecha el 2026-10-08.
  **No empezar la parte 2 (venta, tickets y cola) hasta su OK.**
- **Cómo revisa el dueño:** sobre todo en su PC con Chrome en `localhost`, con la vista de celular (F12) y
  varias ventanas (normal, incógnito y otro perfil) como equipos distintos; la cámara, con la webcam; la
  impresión, con su Xprinter conectada a la PC por su driver y el diálogo normal. El túnel y el celular real,
  solo para la prueba final de cada fase. **Al terminar cada parte hay que darle los pasos:** qué ventana
  registrar como qué equipo, con qué usuario entrar en cada una y qué probar.
- Pruebas en verde: 715 de base de datos, 571 del backend y, en el frontend, 43 de Vitest y 13 recorridos de
  Playwright. Nada se ha subido a GitHub.
- Fuera de F1 / sin probar con equipo real: la impresora (no hay XP-T80A todavía: la página de prueba de
  «Este equipo» la imprime el dueño cuando la tenga; los acentos dependen de cómo venga configurada), la cámara
  en un iPhone y en una tablet reales (solo se probó la lógica; hace falta el túnel), la aplicación instalada en
  un equipo real, y el botón del administrador para reiniciar un PIN (la ruta existe; la pantalla va en F4).
  Los iconos de la app son provisionales (`frontend/scripts/iconos.mjs`) hasta que el dueño entregue el logo.
- Fuera de B5 (decidir si entran más adelante): descargar la plantilla desde la API (hoy está en `docs/`),
  redimensionar las fotos al subirlas y borrar las fotos sueltas que nunca se usaron.
- Fuera de B7: avisos por correo o WhatsApp (decisión del dueño: las alertas solo en el panel); inventario
  valorizado a una fecha cualquiera (solo hoy y el cierre de cada mes); la foto de un mes si el servidor estuvo
  apagado durante todo el mes siguiente (solo se toma la del mes anterior); comparar con el periodo anterior y
  gráficas (eso es del frontend); en los PDF, los caracteres fuera del alfabeto latino (fuentes estándar).
- Fuera de B8: que el
  administrador corrija una solicitud (aprueba o rechaza completa: para corregir se cancela y se hace otra); la
  casilla «admite devolución» en la plantilla de la carga inicial (las categorías nuevas nacen sin ella y se
  marca en el panel); devolver en dólares (siempre en córdobas); revisar si en la caja hay efectivo suficiente
  antes de ejecutar (el arqueo es a ciegas). Sin probar con equipo real: el QR se leyó con un decodificador por
  programa (da el número de factura), pero no impreso en papel térmico y escaneado; los PDF nuevos no se vieron
  en pantalla (solo se prueba su estructura y sus renglones).
- Después de cambiar `db/01_esquema.sql` o `db/02_seed.sql` (el 2026-10-08: todo lo de B8, con dos tablas nuevas,
  la columna `alerta.para_sucursal` y lo del celular y el PIN)
  la base local `esmeralda` queda atrás hasta que se corra `npm run db:recrear`
  (borra lo que tenga: mirar antes si el dueño ya guardó datos propios). `npm run db:tipos` lee esa base: con
  ella atrasada, regenerar los tipos apuntando `DATABASE_URL` a la base de pruebas, que Jest deja al día.
  (Se recreó el 2026-10-08 al terminar el backend de F1: solo tenía los datos demo.)

**Levantar el servidor** (desde `backend/`):

```
npm install             solo la primera vez
copy .env.example .env  solo la primera vez: poner DATABASE_URL y JWT_SECRETO (npm run secreto)
npm run db:recrear      crea la base local "esmeralda" con esquema + seed + datos demo (borra la anterior);
                        hay que repetirlo cuando cambia db/01_esquema.sql
npm run start:dev       API en http://localhost:3000/api  →  probar con http://localhost:3000/api/salud
```

Usuarios de la base local: `admin` / `Esmeralda#2026` (temporal: pide cambiarla al entrar); demo `maria.lopez`
(encargada), `ana.martinez` y `carlos.ruiz` (vendedores) / `Demo#2026`. Para detener el servidor: Ctrl+C.

**Levantar las pantallas** (desde `frontend/`, con el servidor ya corriendo):

```
npm install             solo la primera vez
npm run dev             pantallas en http://localhost:5173 (reenvía /api al servidor)
cloudflared tunnel --url http://localhost:5173    para abrirlas en la tablet o el celular (https)
```

**Correr las pruebas:**

```
db\scripts\probar.cmd   desde la raíz: reglas de la base  →  *** TODAS LAS PRUEBAS PASARON ***
npm run verificar       desde backend/: tipos + oxlint + Prettier + Jest (unitarias, integración y API)
npm run verificar       desde frontend/: tipos + oxlint + Prettier + Vitest + recorridos de Playwright
```

Las tres usan bases propias que se borran y recrean en cada corrida (`esmeralda_test`, `esmeralda_api_test` y
`esmeralda_ui_test`); no tocan la base local `esmeralda`.

## Estructura

```
db/01_esquema.sql      Tablas, reglas, funciones fn_* y vistas v_* (fuente de verdad del negocio)
db/02_seed.sql         Datos iniciales: ubicaciones, roles, permisos, parámetros, gamas, denominaciones, admin
db/03_datos_demo.sql   Datos de demostración (solo desarrollo)
db/04_pruebas.sql      715 pruebas de reglas de negocio
db/scripts/probar.sh   Recrea la BD esmeralda_test y corre todas las pruebas (Linux)
db/scripts/probar.ps1  Lo mismo en Windows (atajo: db\scripts\probar.cmd)
docs/                  Modelo de datos (HTML) y plantilla Excel de carga inicial
```

## Base de datos (PostgreSQL 16, esquema v1.1 terminado)

- Las reglas del negocio viven **en la base de datos** (funciones `fn_*`, triggers y CHECK). El backend
  no reimplementa reglas: llama a las funciones dentro de una transacción.
- Antes de cada operación el backend ejecuta `SET LOCAL app.usuario_id = '<id>'` (auditoría).
- Cada `fn_*` valida permisos (`fn_exigir_permiso`) y ubicación (`fn_exigir_sucursal`).
- Tablas de movimiento son de solo inserción: `movimiento_inventario`, `venta_detalle`, `venta_pago`,
  `cierre_caja_detalle`. Las ventas se anulan, no se borran. Una devolución tampoco se borra ni se reescribe:
  solo avanza de estado (`tg_devolucion_proteger`).
- Para cambiar el esquema: editar `db/01_esquema.sql` (y `02_seed.sql` si aplica), agregar pruebas en
  `db/04_pruebas.sql` y correr `bash db/scripts/probar.sh` (Windows: `db\scripts\probar.cmd`) hasta ver
  `*** TODAS LAS PRUEBAS PASARON ***`. (La línea `ERROR: Venta LBR-MANUAL...` es esperada: prueba un trigger diferido.)
- Las pruebas comparan algunos mensajes del sistema en inglés ("duplicate key"): en un PostgreSQL
  instalado en español, la base de prueba necesita `lc_messages = 'C'` (probar.ps1 ya lo fija).

## Decisiones de negocio clave

- Toda compra entra a la bodega (solo el admin). Gastos de importación prorrateados por valor;
  costo promedio ponderado (incluye lo que va en tránsito). El costeo usa la cantidad **facturada**.
- Envíos en dos pasos: sale al enviar, entra lo escaneado al recibir; faltantes → alerta.
- Mermas y conteos: la sucursal reporta/cuenta, el admin aprueba.
- Se vende pieza, servicio (solo perforación) o **paquete** (perforación + pieza escaneada, cantidad 1).
  Precio del paquete: precio especial → tabla perforación × gama (acero clásica/lujo) → servicio + pieza (titanio).
- El precio cobrado puede subir (máx. +50 %, parámetro), nunca bajar. La única rebaja es una
  **promoción** activa y vigente (una por venta, sobre toda la venta), creada por el admin.
- Venta con `clave_idempotencia` (UUID del POS) para evitar duplicados.
- Número de factura: correlativo por sucursal (`sucursal.ultimo_numero_venta`, `LAM-00000001`) que
  `fn_registrar_venta` toma dentro de la misma transacción de la venta. No deja saltos si la venta falla o se
  reintenta con la misma clave; no cambiarlo por una SEQUENCE (no se devuelve al deshacer). Solo las facturas
  van sin saltos: el número de los envíos (`ENV-000001`) se queda con su SEQUENCE (decisión del dueño, 2026-10-07).
- Caja: un turno al día por sucursal, compartido. Arqueo ciego por denominación; retiro de efectivo;
  lo que queda es el fondo del día siguiente. Diferencia > C$100 → justificación + alerta.
- Roles: ADMIN (todo), ENCARGADO (ventas, anulaciones, recibir, reportar mermas, contar, ver
  diferencias), VENDEDOR (vender, subir precio, promociones, caja, recibir, reportar mermas, contar). Los dos
  últimos solicitan devoluciones y ejecutan las aprobadas (`DEVOLUCIONES_REGISTRAR`); aprobarlas es solo del ADMIN.
- Acceso: el admin entra desde cualquier equipo, con todo. Encargados y vendedores trabajan con todo lo de su
  rol solo desde un **equipo registrado** (caja o tablet) de una de sus sucursales (`fn_equipo_autorizado`);
  sin equipo registrado —su celular— entran con un acceso limitado (ver «Celular y PIN»). La sesión dura 12 h
  en un equipo registrado, 12 h en el celular y 7 días para el admin sin equipo (parámetros
  `SESION_HORAS_EQUIPO`, `SESION_HORAS_CELULAR`, `SESION_DIAS_SIN_EQUIPO`); renovar no la alarga.
  5 contraseñas incorrectas → bloqueo de 15 min. Reusar un token de renovación ya rotado → se cierran
  todas las sesiones del usuario y se alerta (`SESION_REUTILIZADA`).
- Reglas agregadas con el backend (B3 a B5), todas en la base:
  - Se pueden crear roles nuevos; solo se elimina un rol que no es de sistema y sin usuarios.
  - Las sucursales nuevas son siempre de venta (la bodega es única). El código de una sucursal no cambia si ya
    tiene ventas. No se desactiva una sucursal con existencias, turno abierto o envíos en tránsito, ni la bodega;
    en una sucursal o caja inactiva no se abren turnos.
  - No se desactiva un producto o variante con existencias. Las perforaciones (SERVICIO y PAQUETE) solo se
    administran desde su pantalla. Una gama con piezas o precios no cambia de modo de precio.
  - `PRECIOS_EDITAR` permite cambiar precio **y costo** a mano (además del costo promedio de las compras).
  - Las duraciones de sesión tienen mínimo 1 (`parametro.minimo`).
  - Carga inicial: solo crea lo que falta; el inventario inicial entra a la bodega y se reparte con envíos. De
    lo que ya existe solo cambia precios: tabla de paquetes, precios especiales, precio de solo servicio de las
    perforaciones y precio de venta de los productos (el costo no: es el promedio de las compras).
- POS y caja (B6; decisiones del dueño del 2026-10-06), todas en la base:
  - La sucursal, la caja y el turno **no los manda la pantalla**: salen del equipo registrado de la sesión
    (`fn_caja_de_sesion`, `fn_turno_de_sesion`). PC de caja → su caja. Tablet → la única caja abierta de su
    sucursal (con dos abiertas, se trabaja desde la PC de la caja); para abrir, la única caja activa. El
    **administrador** sin caja en su equipo (o sin equipo registrado) indica la caja y puede vender, abrir y
    cerrar; sentado en una PC de caja usa la de ese equipo. Encargados y vendedores nunca eligen.
  - **Arqueo ciego:** quien abre o cierra nunca ve el monto esperado ni la diferencia. Se abre declarando lo
    contado, sin ver el fondo que dejó el cierre anterior. Lo esperado y las diferencias solo se ven con
    `CAJA_VER_DIFERENCIAS`.
  - **Un solo reconteo:** si el primer conteo no cuadra (más que la tolerancia) y no trae justificación, la caja
    no se cierra y queda anotado (`turno_caja.intentos_cierre`); desde el segundo, la justificación es obligatoria
    —cuadre o no— y se cierra con lo contado. Así no se puede adivinar lo esperado probando conteos.
  - **Ticket de cierre:** quien cierra recibe lo que contó, lo que retiró y el fondo; lo vendido y lo cobrado por
    método solo con `CAJA_VER_DIFERENCIAS`. En un cierre forzado (sin conteo) el ticket reducido no trae montos.
  - **Tipo de cambio:** solo se registra el de hoy y se puede corregir durante el día (`fn_set_tipo_cambio`); cada
    venta guarda el suyo, así que el cambio vale para las ventas siguientes. Los días anteriores no se editan.
    Control contra errores de dedo (pedido del dueño, 2026-10-07): si el valor se aleja del **último registrado**
    (el vigente, sea de hoy o de un día anterior) más que el parámetro `TIPO_CAMBIO_VARIACION_MAX` (5 %; justo
    el 5 % pasa), se rechaza salvo confirmación explícita. Si no hay ninguno anterior, solo entra entre 20 y 60
    (fijo en la función; ahí la confirmación no cuenta).
  - **Ticket de venta:** la API entrega los datos y la pantalla lo imprime (el PDF va con B7). Encabezado y pie
    con los parámetros `NEGOCIO_NOMBRE`, `NEGOCIO_RUC` y `TICKET_LEYENDA` (el RUC y la leyenda están vacíos: el
    dueño los llena en el panel).
- Reportes (B7; decisiones del dueño del 2026-10-07):
  - **Solo el administrador ve costos:** costo, margen e inventario valorizado piden `REPORTES_COSTOS`, que solo
    tiene el ADMIN. El encargado ve ventas, cobros, cierres y mermas en cantidades, de sus sucursales. El
    vendedor no ve reportes. No hay permisos nuevos.
  - **Arqueo ciego en los reportes:** sin `CAJA_VER_DIFERENCIAS`, los reportes de ventas y cobros no incluyen
    las ventas de un turno todavía abierto (con ellas se deduciría lo esperado en caja).
  - **Inventario valorizado:** la foto de hoy y, además, una foto automática al cierre de cada mes.
  - **Mermas:** suman solo las aprobadas, con el costo del momento en que se aprobaron; las pendientes y las
    rechazadas se listan aparte.
  - **Tickets en PDF:** papel de 80 mm; la reimpresión lleva la palabra «COPIA». Cada impresión se anota en
    `ticket_impresion` (`fn_registrar_impresion_venta` / `_cierre`): la primera es el original, la pida quien
    la pida; vale igual para el ticket de cierre.
  - **Alertas:** una nueva cuando alguien confirma un tipo de cambio fuera del límite
    (`TIPO_CAMBIO_FUERA_LIMITE`, la crea `fn_set_tipo_cambio`). El stock bajo el mínimo no es alerta: es el
    reporte «por reponer». Las alertas siguen solo en el panel (correo y WhatsApp, fuera).
  - **Foto mensual:** las cantidades salen del kardex (suma de movimientos anteriores al cambio de mes), así
    que son las del cierre aunque la tarea corra tarde; el costo y el precio son los del momento en que se toma.
  - **Reportes extra incluidos:** productos más vendidos, perforaciones con pieza contra solo servicio, ventas
    por gama, promociones y sobreprecios. Desde el 2026-10-08, además, compras por proveedor y piezas
    consumidas en paquetes: solo para el administrador, porque muestran costos.
- Devoluciones y cambios (B8; reglas y ajustes del dueño del 2026-10-08), todas en la base:
  - **Solo para ventas de un turno ya cerrado:** con el turno abierto la venta se anula, como antes. La factura
    original nunca se modifica.
  - **Qué se devuelve:** nunca piezas de piercing, perforaciones ni paquetes. Lo decide la casilla
    `categoria.admite_devolucion`, que solo marca el administrador (`DEVOLUCIONES_APROBAR`, no
    `PRODUCTOS_GESTIONAR`); una categoría nueva nace sin ella. En los datos iniciales: joyería, accesorios,
    perfumería y cuidado posterior, sí; los tres de piercing y las perforaciones, no.
  - **Plazo:** `DEVOLUCION_DIAS_MAX` (7) días calendario de Managua desde el día de la venta, contados al crear
    la solicitud. Parcial por línea y cantidad, sin pasar de lo vendido menos lo ya devuelto y lo **apartado** en
    solicitudes pendientes o aprobadas.
  - **Tres pasos:** (1) la sucursal solicita (tipo, líneas con su estado bueno o defectuoso, motivo y, obligatorios,
    nombre y teléfono del cliente) y queda una alerta para el administrador; (2) solo el administrador aprueba o
    rechaza (rechazar pide comentario); (3) la aprobada se ejecuta en la caja abierta de la sucursal donde esté el
    cliente, que puede ser otra. Quien la solicitó o el administrador la pueden cancelar antes de ejecutarla.
  - **La aprobada vence:** `DEVOLUCION_APROBADA_DIAS` (3). Pasado su último día la cancela sola la tarea
    programada (`fn_vencer_devoluciones`) y libera lo apartado. Deja dos alertas `DEVOLUCION_VENCIDA` iguales,
    sin montos: una para el administrador y otra para la sucursal que la solicitó (pedido del dueño, 2026-10-08).
    Cada quien atiende la suya. Cancelarla a mano no deja alerta.
  - **Monto:** lo que de verdad se pagó por esas unidades, con la promoción descontada en proporción, en
    córdobas. El reparto no pierde centavos: devuelta por partes, una factura devuelve exactamente lo pagado.
  - **Reembolso según cómo se pagó la factura:** la parte pagada en efectivo (C$ o US$) sale en córdobas de la
    caja del turno y cuenta en lo esperado del arqueo; la parte pagada con tarjeta o transferencia la transfiere
    el administrador, queda anotada con su referencia y no pasa por la caja; en pagos mixtos, en proporción.
  - **Cambio:** una venta nueva (cualquier producto, **sin promoción**: si no, se podría devolver algo a precio
    completo y llevarse lo mismo rebajado) donde lo devuelto entra como el método de pago interno «Saldo por
    cambio». Si lo nuevo cuesta más, la diferencia se paga con los métodos normales; si cuesta menos, lo que
    sobra se reembolsa como en una devolución, según cómo se pagó la factura original (confirmado por el dueño). Lo que se lleva se elige al ejecutar, no al solicitar. Esa venta
    no se anula; lo comprado en ella se puede devolver después.
  - **Inventario:** lo devuelto entra al stock de la sucursal donde se ejecuta (movimiento `DEVOLUCION`, al costo
    con que se vendió); lo defectuoso sale enseguida como merma ya aprobada. Todo queda en el kardex.
  - **Número propio sin saltos:** `DEV-<sucursal>-000001` (`sucursal.ultimo_numero_devolucion`), tomado al
    ejecutarse; rechazadas, canceladas y fallidas no toman número. Ticket de 80 mm con la firma del cliente.
  - **Reportes:** las ventas van netas (ventas menos devoluciones) por la fecha de la devolución, y se le restan
    a quien hizo la venta original y a su sucursal; el dinero sale de la sucursal donde se ejecutó. Hay un
    reporte de devoluciones con su motivo; el nombre y el teléfono del cliente solo los ve el administrador.
  - **Arqueo ciego:** la vendedora ve el monto de cada devolución (tiene que entregarlo), nunca sumas. En el
    ticket de cierre y en los reportes, las devoluciones de un turno abierto solo con `CAJA_VER_DIFERENCIAS`.
  - **Ticket de venta con QR:** lleva el número de factura en un código QR para buscar la venta al devolver.

- Celular y PIN (backend de F1; decisiones del dueño del 2026-10-08), todas en la base:
  - **El celular** es cualquier sesión sin equipo registrado de quien no es administrador. Ahí solo valen los
    permisos marcados `permiso.sin_equipo`: consultar productos, precios, existencias y kardex; ver y recibir
    envíos; conteos; buscar una factura y solicitar su devolución; **vender**. Todo lo demás responde
    «solo desde un equipo registrado»: abrir y cerrar turno, anular, movimientos de efectivo, ejecutar
    devoluciones, registrar el tipo de cambio, mermas, reportes, imprimir en papel.
  - **Vender desde el celular:** solo con un turno abierto en su sucursal; la venta entra a ese turno con las
    reglas de siempre y queda a su nombre. Con más de una caja abierta elige la caja; si trabaja en varias
    sucursales, elige la sucursal (`fn_turno_para_venta`, `fn_cajas_abiertas`).
  - **Cada venta guarda desde dónde se hizo** (`venta.origen`: `EQUIPO` o `CELULAR`) y solo el administrador
    lo ve: en la venta, en el reporte de ventas y en el de cierres.
  - **Desde el celular solo se ven las ventas propias del turno abierto**, sin totales; ni las de otras
    personas ni las de turnos anteriores. El arqueo sigue a ciegas.
  - **Ticket de una venta hecha desde el celular (va en F2a, todavía no programado):** las dos opciones siempre.
    (1) Cola de impresión: la venta aparece en la tablet de esa sucursal en «Tickets por imprimir» y se imprime
    con un toque, o sola con el parámetro `IMPRESION_AUTOMATICA_COLA`; imprimir desde la cola cuenta como
    original, no como COPIA. (2) Ticket digital: compartir el PDF desde el celular (WhatsApp u otra app).
  - **PIN de 4 dígitos** para el cambio rápido en un equipo registrado. El equipo **se abre una vez al día**
    con una contraseña (la primera persona); abierto, acepta el PIN de quienes están asignadas a su sucursal,
    hasta que alguien lo cierre o pasen las 12 h. Sin eso el PIN no sirve. Cada PIN abre la sesión de esa
    persona: todo queda a su nombre. El administrador no tiene PIN; desde el celular no se entra con PIN.
  - **PIN bloqueado** a los 5 intentos fallidos seguidos, con alerta `PIN_BLOQUEADO` al administrador. Ella
    crea uno nuevo entrando con su contraseña (la alerta queda); el administrador también puede reiniciarlo.
    No vale `0000`, `1234` ni parecidos. Se guarda con hash.
  - **La pantalla se bloquea** a los 3 minutos sin uso (`PANTALLA_BLOQUEO_MINUTOS`, de 1 a 30), solo en
    equipos registrados.
  - **Código de los productos (va en F3b):** prefijo de la categoría + correlativo de 5 dígitos por categoría
    (`PTI-00001`), uno por variante, en el campo `sku`; el QR de la etiqueta lleva solo el código.

Documentos de referencia (claude.ai): "Sistema Esmeralda — Documento de diseño" y
"Sistema Esmeralda — Resumen para la dirección".

## Etapa actual: frontend (`frontend/`)

Pedido por el dueño el 2026-10-08: **React + Vite como PWA**. Ese mismo día aprobó el plan por fases, sus
librerías (React 19, Vite 8, TypeScript 6.0 como el backend, React Router, TanStack Query, Zod + React Hook Form,
Tailwind 4 + Radix + lucide, vite-plugin-pwa, barcode-detector, Recharts; Vitest + Testing Library + MSW +
Playwright; oxlint + Prettier) y los diseños del celular, el PIN, la impresión por WebUSB y el código de los
productos. Se programa **una fase a la vez** y se espera su revisión antes de la siguiente.

| Fase | Contenido |
|---|---|
| F1 | Base: sesión con refresco de token, pantalla de PIN y bloqueo por inactividad, registrar el equipo, menú según rol y permisos (y según si es la tablet o el celular), cliente de la API, archivo de tema, centro de alertas, prueba de cámara y de impresora. Primero el backend que hace falta (celular y PIN, ya hecho) |
| F2a | En dos partes: (1) caja y consulta de precios, hecha; (2) venta, tickets y cola. Caja y venta: abrir turno, tipo de cambio de hoy, consulta de precios y existencias, vender (buscador y escaneo, paquetes, promoción, pagos mixtos C$/US$, vuelto; también desde el celular), anular, movimientos de efectivo, cierre ciego, tickets por WebUSB, cola de impresión y ticket digital |
| F2b | Devoluciones y cambios: buscar la factura por el QR, solicitar, aprobar, ejecutar, anotar transferencias |
| F3 | Inventario: envíos con recepción por escaneo, mermas y conteos con su aprobación, existencias y kardex |
| F3b | Códigos y etiquetas: código automático de cada producto y PDF de etiquetas con QR (solo en la bodega) |
| F4 | Administración: usuarios, roles, sucursales, equipos, categorías, productos y precios, compras, promociones, parámetros, historial del tipo de cambio, carga inicial |
| F5 | Reportes: filtros por periodo, comparación con el periodo anterior, gráficas, descargas en Excel y PDF |
| F6 | Puesta en producción: VPS en internet con dominio y HTTPS |

**Decisiones del dueño (2026-10-08):**

- **Equipos.** Tablets Android con Chrome en las sucursales (todavía sin comprar: serán USB-C, con un hub
  USB-C OTG con carga): ahí se hace todo lo de caja. Las trabajadoras entran también desde su celular personal
  (iPhone, Safari), con el acceso limitado de «Celular y PIN», que incluye vender. El dueño aprueba desde su
  iPhone.
- **Impresora:** Xprinter XP-T80A (80 mm, ESC/POS, USB y red, salida de gaveta de 24 V; todavía sin gaveta),
  conectada por USB a la tablet con un adaptador OTG. Impresión directa desde Chrome por **WebUSB** con ESC/POS:
  ticket de venta, de cierre y de devolución, con corte y el QR de la factura. Apertura de gaveta lista pero
  apagada, con un parámetro. El diálogo de imprimir del sistema queda de respaldo. Reintentar una impresión que
  falló no debe marcarla como COPIA.
- **Servidor:** un VPS en internet con dominio y HTTPS (F6). Para probar en la tablet y el celular, un túnel de
  Cloudflare.
- **Códigos y etiquetas:** las piezas no tienen código. El sistema genera el de cada producto al crearlo. Las
  etiquetas con QR se imprimen solo en la bodega, al registrar una compra o desde el producto, eligiendo cuántas
  copias; todavía sin impresora de etiquetas: un PDF con tamaño configurable.
- **Escanear nunca es el único camino:** en todas las pantallas donde se escanea (venta, envíos, conteos,
  devoluciones) hay además un buscador por nombre o código para elegir el producto tocándolo.
- **Sin internet no se vende** (la app avisa y deja reintentar sin duplicar).
- **Cambio rápido de vendedora con PIN:** ver «Celular y PIN» en las decisiones de negocio.
- **Al terminar cada fase:** todo en verde, «Estado actual» al día y, si hay que probar en la tablet o el
  celular, las instrucciones del túnel de Cloudflare. La etiqueta `backend-completo` y el respaldo se mueven
  cada vez que el backend cambia.

**Identidad visual (decidida por el dueño).** Variables CSS en un solo archivo de tema:

```
--esmeralda: #0B6E4F;  --esmeralda-oscuro: #064E3B;  --esmeralda-claro: #E3F2EC;
--oro: #B8893B;  --oro-claro: #F6EEDC;  --oro-texto: #7A5A1E;
--fondo: #FAF8F3;  --superficie: #FFFFFF;  --borde: #E5E1D8;
--texto: #1F2A26;  --texto-secundario: #5C6661;
--exito: #15803D;  --aviso: #B54708;  --error: #B42318;  --info: #1D5FA8;
```

- Esmeralda: botones principales, barra superior y selección; esmeralda oscuro: la barra y el hover.
- Oro solo como acento (promociones, etiquetas, el «Experience» del nombre). Nunca como texto sobre blanco: fondo
  oro claro con texto oro oscuro.
- El éxito siempre con ícono de check (para no confundirlo con el verde de la marca).
- Ámbar (aviso): diferencias de caja, devoluciones pendientes y avisos de tipo de cambio. Rojo: solo errores,
  anulaciones y rechazos.
- Solo modo claro.
- Barra superior: «Esmeralda Experience» en texto («Experience» en oro claro) y un espacio para el logo (lo agrega
  el dueño después). Con un turno abierto muestra siempre la sucursal, la caja y el tipo de cambio del día.
- **El arqueo ciego también rige en pantalla:** la vendedora nunca ve el monto esperado, la diferencia ni los
  totales del turno.

### Convenciones del frontend

- Comandos (en `frontend/`): `npm run verificar` (tipos + oxlint + Prettier + Vitest + Playwright) en verde antes
  de cada commit; `npm run dev`; `npm run build`. TypeScript 6.0, como el backend. Texto y nombres en español.
- **Un solo origen:** las pantallas llaman a `/api/...` y Vite lo reenvía al backend (`API_DESTINO`, por defecto
  `http://localhost:3000`). No hay CORS ni direcciones del backend en el código.
- `src/api/cliente.ts`: `api<T>(metodo, ruta, { cuerpo, publica })`. El token de acceso vive en memoria; ante un
  401 renueva la sesión **una sola vez** (aunque fallen varias solicitudes) y repite. Los errores son `ErrorApi`
  (`codigo`, `message` en español, `estado`, `errores` por campo); `mensajeDeError()` da el texto a mostrar. Las
  rutas de login, PIN y refresh van con `publica: true`. Tipos de las respuestas en `src/api/tipos.ts` (a mano,
  en snake_case como la API).
- `src/sesion/sesion.tsx`: `ProveedorSesion` con tres fases (`cargando`, `fuera` con la `PantallaPin`, `dentro`
  con la sesión). `useSesion()` da las acciones (`entrar`, `entrarConPin`, `bloquear`, `cerrarEquipo`,
  `refrescar`); `useSesionActiva()` da la sesión en las pantallas de adentro; `tienePermiso(sesion, [...])`.
  Bloquear es cerrar la sesión (`/auth/logout`): la siguiente persona entra con su PIN. Al quedar fuera se
  limpia la caché de consultas (lo que vio una no lo ve la otra) y la dirección vuelve a `/`.
- Bloqueo por inactividad: `useInactividad(minutos, alVencer)`; solo en un equipo registrado.
- `src/menu.ts`: todo el menú, con el permiso y la **fase** de cada opción. `FASES_LISTAS` dice qué está hecho:
  al terminar una fase se agrega ahí y se registran sus rutas en `App.tsx`. Lo que no está hecho sale marcado
  «Pronto» y abre una pantalla que dice en qué fase llega. El menú del celular no tiene reglas propias: la API
  ya entrega menos permisos.
- Datos del servidor con TanStack Query (`src/api/consultas.ts` para lo compartido: alertas pendientes, turno,
  tipo de cambio). **Arqueo ciego en pantalla:** nunca pedir `/api/turnos` ni sumar montos para quien no tiene
  `CAJA_VER_DIFERENCIAS`; `GET /api/caja/turno` no trae montos y solo se pide desde un equipo registrado.
- Tema: los colores solo en `src/tema/tema.css` (variables CSS + `@theme` de Tailwind 4: `bg-esmeralda`,
  `text-oro-texto`...). Piezas base en `src/ui/` (`Boton`, `Campo`, `Selector`, `Tarjeta`, `Aviso`, `Etiqueta`,
  `TecladoPin`, `Confirmacion`): alto mínimo de toque de 48 px (`min-h-toque`). `Aviso tipo="exito"` lleva su
  check. Las alertas van en ámbar o azul, nunca en rojo. Formularios con React Hook Form + Zod, repitiendo la
  regla de forma del backend (contraseña, PIN) para avisar antes de enviar.
- Diseño: primero tablet (menú a la izquierda desde 768 px); en celular el menú va abajo con «Más». Usar
  etiquetas `<label htmlFor>` (no envolver el control): las pruebas buscan por etiqueta.
- Caja (F2a parte 1): `pantallas/Caja.tsx` (abrir, tipo de cambio de hoy con el 409 `CONFIRMACION_REQUERIDA`,
  movimientos, cierre por denominaciones con el 422 `CONTEO_NO_CUADRA` y su único reconteo, ticket),
  `pantallas/Turnos.tsx` (historial con diferencias y cierre forzado: solo con `CAJA_VER_DIFERENCIAS`) y
  `pantallas/Consulta.tsx` (buscador + escáner). El administrador sin equipo elige la caja y todas sus
  llamadas llevan `caja_id`. Las cuentas de la pantalla van en centavos (`util/dinero.ts`) y solo suman lo
  que la persona escribe: nada de esperados.
- Imprimir un ticket: `<BotonImprimir ruta="/turnos/9/imprimir" />`. Decide el modo con `modoDeImpresion()`
  (`usb` solo en Android con WebUSB; si no, `dialogo`): por USB pide `?formato=renglones` y los traduce con
  `comandosDeTicket()`; por diálogo pide el PDF (`apiArchivo`) y lo imprime desde un marco oculto. Guarda lo
  pedido: reintentar no vuelve a llamar a la API (no sale COPIA). La conexión con la impresora se comparte
  (`impresoraLista()`, `conectarImpresora()`, `imprimirPorUsb()` en `equipo/imprimir.ts`).
- Pantalla encendida: `equipo/despierta.tsx` (`PantallaDespierta` envuelve la app; `useDespierta()` da el
  estado). Activa con sesión en un equipo registrado o en su pantalla de PIN con el equipo abierto.
- Equipo: `src/equipo/impresora.ts` (WebUSB propio, filtra por clase USB de impresora; `enviar()` lanza si
  falla, para poder reintentar el mismo ticket sin que cuente como copia; ESC/POS con
  `@point-of-sale/receipt-printer-encoder`, 48 columnas, mapa de páginas `xprinter`) y
  `src/equipo/EscanerCamara.tsx` (lector nativo en Android; en iPhone, `barcode-detector` con su `.wasm` servido
  por la app). La pantalla «Este equipo» se carga aparte (`lazy`) porque trae esas dos librerías.
- PWA (`vite-plugin-pwa`): el service worker guarda solo la aplicación, **nunca** respuestas de `/api`. En
  `npm run dev` no se registra: para probar la app instalada, `npm run build && npm run preview`.
- Pruebas: `src/**/*.spec.{ts,tsx}` con Vitest + Testing Library; `App.spec.tsx` monta la app completa contra una
  API simulada con MSW (cada respuesta se crea nueva: un cuerpo no se lee dos veces). Recorridos en `e2e/` con
  Playwright contra el backend real: `e2e/servidor-api.mjs` recrea `esmeralda_ui_test`, compila el backend y lo
  levanta en el puerto 3100; van en orden y con un solo trabajador (`tablet.spec.ts`, `celular.spec.ts` y
  `caja.spec.ts`, que registra un celular del negocio en cada sucursal y trabaja con las dos a la vez).
  Para ver cómo queda una pantalla: una captura con Playwright a un archivo temporal.

## Etapa terminada: backend (`backend/`)

Stack: Node 22.12+ (desarrollo en Node 24) + TypeScript, **NestJS**, **Kysely** + `pg` (consultas tipadas; llama a las `fn_*`),
Zod para validar entrada, exceljs (carga inicial y reportes en Excel), pdfkit (reportes y tickets en PDF), qrcode (el QR del
ticket de venta), argon2id para contraseñas, JWT de acceso (15 min) + refresh en cookie httpOnly
(hash SHA-256 en tabla `sesion`), pruebas con Jest + supertest contra una BD de prueba.

| Paso | Contenido |
|---|---|
| B1 ✅ | Proyecto base, conexión a PostgreSQL, configuración, transacción con `app.usuario_id` |
| B2 ✅ | Login, sesión renovable, bloqueo por intentos, cambio obligatorio de contraseña, registro de equipos |
| B3 ✅ | Panel admin: usuarios, roles/permisos, equipos, parámetros, alertas |
| B4 ✅ | Catálogo: productos, perforaciones, gamas, precios de paquetes, promociones |
| B5 ✅ | Inventario: compras, envíos/recepción, mermas, conteos (y carga inicial desde Excel) |
| B6 ✅ | POS y caja: venta, cobro, apertura, cierre, ticket |
| B7 ✅ | Reportes, exportación (Excel/PDF), tickets en PDF, tareas programadas (`fn_alertar_cajas_sin_cerrar`, foto mensual) |
| B8 ✅ | Devoluciones y cambios de ventas de turnos cerrados, casilla de las categorías, QR en el ticket, ventas netas |

### Convenciones del backend

- Comandos (en `backend/`): `npm run verificar` (tipos + oxlint + Prettier + Jest) debe quedar en verde
  antes de cada commit; `npm run start:dev`; `npm run db:recrear` (base local de desarrollo);
  `npm run db:tipos` después de cambiar el esquema (regenera `src/base-datos/tipos-bd.ts`, no editarlo a mano).
- Versiones: NestJS 12 y Kysely 0.29 se publican **solo como ESM**; el proyecto compila a CommonJS y Node los
  carga con `require(esm)` (como la plantilla oficial "ts" de Nest 12). Jest corre con `--experimental-vm-modules`.
  TypeScript fijado en **6.0** porque ts-jest aún no soporta TypeScript 7.
- Configuración: variables de entorno validadas con Zod en `src/configuracion/configuracion.ts`
  (`backend/.env`, no se sube; plantilla en `.env.example`). `DATABASE_URL` lleva la contraseña
  (codificada, `@` → `%40`): `pg` 8.23 marcó como obsoleto leer `pgpass.conf`. `JWT_SECRETO` (≥ 32 caracteres,
  `npm run secreto`), `LOGIN_LIMITE_POR_MINUTO` (por IP), `TRUST_PROXY` (detrás de nginx/Caddy), `DIR_FOTOS`
  (carpeta de las fotos subidas; en el servidor debe entrar en los respaldos) y `TAREAS_PROGRAMADAS` (por
  defecto `true`; las pruebas la ponen en `false`).
- API: rutas bajo `/api`; JSON en **snake_case** (igual que la base: `debe_cambiar_password`, `sucursal_id`).
  Entrada validada con `@Body(new ValidacionZod(esquema))` → 400 `DATOS_INVALIDOS` con `errores` por campo.
- Autenticación (`src/autenticacion/`): toda ruta exige `Authorization: Bearer <JWT>` salvo `@Publica()`;
  con contraseña temporal solo pasan las `@PermitidaConPasswordTemporal()`. `@UsuarioActual()` da
  `{ id, sesionId, rol, debeCambiarPassword, equipo: { id, sucursalId, cajaId } | null }` → usar `id` como
  `usuarioId` de `transaccion()` y `equipo` para validar sucursal/caja (B6). Cookies httpOnly + SameSite=Strict:
  `esmeralda_sesion` (refresh, path `/api/auth`) y `esmeralda_equipo` (equipo registrado, path `/api`, 400 días).
- Permisos: cada ruta que no sea de uso general lleva `@RequierePermiso('CODIGO')` (`src/autenticacion/permisos.ts`),
  que consulta `fn_permiso_en_sesion` **antes** de validar los datos enviados (403 `PERMISO_DENEGADO`). El permiso se
  consulta en la base en cada solicitud (el token solo lleva el rol): cambiar los permisos de un rol o desactivar
  a un usuario aplica de inmediato. En las escrituras la `fn_*` lo valida otra vez dentro de la transacción.
- Contraseñas: argon2id; se aceptan los hashes **bcrypt** del seed (`$2a$`, vía `crypt()`) y, como el seed obliga
  a cambiarla al entrar, la nueva queda en argon2id. La política (mín. 8, letras y números) vive en
  `esquemas.ts` porque la base nunca ve el texto plano. Al crear un usuario o resetear su contraseña, el backend
  genera la **contraseña temporal** (`generarPasswordTemporal`, p. ej. `k7mx-9qdw-t3hp`) y la devuelve una sola vez.
- Panel (B3): un módulo por recurso (`usuarios/`, `roles/`, `equipos/`, `parametros/`, `alertas/`, `sucursales/`),
  cada uno con `*.controller.ts`, `*.service.ts` y `esquemas.ts`. Respuestas con el recurso envuelto
  (`{ usuario }`, `{ usuarios }`). Ids de la ruta con `@Param('id', idEntero())` / `idUuid()` (`src/comun/esquemas.ts`);
  recurso inexistente en una lectura → `throw new NoEncontrado('...')` (404). Editar parámetros y permisos de un rol
  pasa por `fn_set_parametro` y `fn_set_permisos_rol` (el rol ADMIN no se edita; nadie otorga un permiso que no tiene).
  Solo un administrador puede editar, desactivar, resetear la contraseña o cerrar las sesiones de otro
  administrador (`fn_exigir_gestion_usuario`), aunque otro rol reciba `USUARIOS_GESTIONAR`.
- Alertas para la sucursal: una alerta con `para_sucursal = true` (siempre con `sucursal_id`) es un aviso para
  quienes trabajan en esa sucursal. No sale en `GET /api/alertas` (panel, `ALERTAS_VER`): se lee en
  `GET /api/alertas/sucursal`, sin permiso, con los mismos filtros. Si algo le interesa al administrador y a la
  sucursal se insertan **dos** alertas (una de cada clase), para que cada quien atienda la suya. `POST
  /api/alertas/:id/atender` no lleva `@RequierePermiso`: decide `fn_atender_alerta` (`fn_puede_ver_alerta`:
  `ALERTAS_VER`, o trabajar en la sucursal si es para ella; si no, 403). Un aviso para la sucursal lo puede leer
  cualquier rol de esa sucursal: no ponerle montos ni nada del arqueo.
- Vistas (`v_*`) en Kysely: los tipos generados marcan todas sus columnas como posiblemente nulas; se declara la
  fila real y se usa `.$castTo<Fila>()`.
- Catálogo (B4): módulos `categorias/`, `gamas/`, `productos/` (productos y variantes), `perforaciones/` y
  `promociones/`. Toda escritura pasa por una `fn_*` (`fn_guardar_categoria`, `fn_guardar_gama`,
  `fn_guardar_producto`, `fn_crear_variante`, `fn_actualizar_variante`, `fn_set_precio_variante`,
  `fn_actualizar_perforacion`, `fn_set_*_activ[oa]`...). Las perforaciones son productos de tipo SERVICIO y
  PAQUETE: aparecen en `/api/productos`, pero solo se administran en `/api/perforaciones`. Reglas de la base: no
  se desactiva un producto o variante con existencias; una gama con piezas o precios no cambia de modo de precio;
  la categoría "Perforaciones" es del sistema.
- Montos en la entrada: `monto()` / `montoPositivo()` de `src/comun/esquemas.ts` aceptan número o texto con hasta
  2 decimales y entregan texto (`"650.5"`), que va a la base con `${valor}::numeric`. Los parámetros que pueden
  ser null llevan su tipo en el SQL (`${id}::integer`, `${fecha}::date`).
- El **costo** solo sale para quien tiene `REPORTES_COSTOS`: se enmascara en la propia consulta
  (`case when (select fn_tiene_permiso(usuario, 'REPORTES_COSTOS')) then v.costo end`), no en TypeScript.
- Lo que en la base se llama `activa` (categoría, gama, perforación, promoción, sucursal, caja) usa `esquemaActiva`
  y la ruta `/activa`; lo que se llama `activo` (usuario, equipo, producto, variante, proveedor), `esquemaActivo`
  y `/activo`.
- `@RequierePermiso('A', 'B')` con varios permisos pide **uno** de ellos (listas que ven tanto la sucursal como
  el admin: envíos, mermas, conteos); puede ir en el controlador entero (`proveedores`, `compras`).
- Inventario (B5): módulos `proveedores/`, `compras/`, `envios/`, `mermas/`, `conteos/` e `inventario/`. Alcance
  de las listas: cada quien ve lo de **sus** sucursales (`fn_puede_operar_sucursal` en el `where`); un registro
  ajeno responde 404. La cantidad de la bodega se oculta con `fn_ve_cantidad_bodega`. El conteo es a ciegas: el
  detalle del conteo no trae el stock del sistema; las diferencias piden `INVENTARIO_AJUSTAR`.
- Consultas con filtros opcionales: `donde(cond1, filtro.x && sql`...`)` y `patronContiene()` de
  `src/comun/consultas.ts`; fechas `desde`/`hasta` con `inicioDelDia()` / `finDelDia()` de `src/comun/fechas.ts`
  (día de Managua). Paginación: `limite` + `antes_de` (por id, listas que crecen) o `desplazamiento` (catálogos).
- Fotos (`fotos/`): se guardan en `DIR_FOTOS` (por defecto `backend/almacen/fotos`, fuera de Git) con nombre al
  azar; el formato se decide por el contenido (JPG, PNG, WebP; máx. 5 MB). `GET /api/fotos/:archivo` es pública
  porque una `<img>` no envía el token. La base solo guarda la dirección (`foto_url`).
- Carga inicial (`carga-inicial/`): `plantilla.ts` lee el Excel (exceljs) sin depender de fórmulas calculadas;
  el servicio valida cada fila con el **mismo esquema Zod** de la API y la guarda con la **misma `fn_*`**, todo
  en una transacción con un `savepoint` por fila para juntar todos los errores. Simula por defecto
  (`?aplicar=true` para guardar). Solo crea lo que falta; lo repetido dentro del archivo es error. A un producto
  que ya existe le actualiza el precio de venta con `fn_set_precio_variante` (pide `PRECIOS_EDITAR`, queda en el
  historial de precios y se cuenta en `resumen.precios_actualizados`); a una perforación que ya existe, igual
  con su precio de solo servicio (`resumen.precios_servicio_actualizados`). Un producto o una perforación que
  ya existe y viene dos veces en el archivo es un error (no se sabría qué precio vale).
- POS y caja (B6): módulos `caja/` (rutas `/api/caja/turno...`, `/api/turnos...`, `/api/metodos-pago`,
  `/api/denominaciones`), `ventas/` y `tipo-cambio/`. Ningún esquema de entrada lleva sucursal ni turno: los
  servicios reciben el `UsuarioAutenticado` completo y resuelven la caja con `caja/sesion-caja.ts`
  (`exigirTurno()`, `turnoDeSesion()`, `cajaParaAbrir()`), que pasa `usuario.equipo.id` a la base; esta vuelve a
  leer el equipo en cada solicitud (desactivarlo aplica de inmediato → 403). `caja_id` solo existe para el
  administrador sin caja en su equipo (sin equipo y sin `caja_id` → 400). Sin turno abierto → 409
  `SIN_TURNO_ABIERTO`.
  - `POST /api/ventas` exige `clave_idempotencia` (UUID): 201 la primera vez; 200 y `repetida: true` si la clave
    ya era de una venta del mismo vendedor y turno; si no, 409 `CLAVE_REUTILIZADA`. Alcance de las consultas:
    `VENTAS_VER_TODAS` → sus sucursales; solo `VENTAS_VER_PROPIAS` → las propias; una venta ajena responde 404.
  - Cierre: `fn_cerrar_turno` **no lanza error** cuando el primer conteo no cuadra (devuelve `{"cerrado": false}`
    para que el intento quede guardado); el servicio responde 422 `CONTEO_NO_CUADRA` después de confirmar la
    transacción. Ninguna respuesta de `/api/caja/...` trae montos esperados ni diferencias: solo `/api/turnos`
    (`CAJA_VER_DIFERENCIAS`). Qué trae el ticket de cierre lo decide la base (`fn_ticket_cierre(turno, completo)`).
  - Las funciones que devuelven JSON (`fn_ticket_cierre`) entregan los montos como número: el servicio los pasa a
    texto con 2 decimales, como el resto de la API.
  - `PUT /api/tipo-cambio` acepta `confirmar` (solo `true` cuenta). Cuando la base pide la confirmación lanza el
    SQLSTATE `ESM02`, que `FiltroErrores` traduce a 409 `CONFIRMACION_REQUERIDA` con el mensaje de la base: la
    pantalla pregunta y reenvía con `confirmar: true`. Sirve para cualquier otra función que pida confirmar.
  - `GET /api/tipo-cambio/historial` (`TIPO_CAMBIO_GESTIONAR`): un día por fila. La tabla `tipo_cambio` guarda
    solo el último valor de cada día; lo registrado antes de una corrección sale de la bitácora (`auditoria`,
    que anota cada cambio de esa tabla con su hora) y va en `registros`.
  - `test/pos.e2e-spec.ts` trabaja en una sucursal propia (`PVE`) con su caja, su PC de caja y su tablet; usa una
    pieza de gama Titanio (las otras pruebas cuentan las piezas y los precios de las gamas de acero) y al final
    deja el tipo de cambio como estaba (una prueba borra los registrados mientras dura y los repone: vale porque
    Jest corre con `--runInBand`). Hace `app.listen(0)` porque envía dos solicitudes a la vez.
- Reportes (B7): módulos `reportes/` (rutas `/api/reportes/...`), `exportacion/` y `tareas/`.
  - Todos los reportes devuelven un `Reporte` (`reportes/reporte.ts`): secciones con `columnas`, `filas` y
    `totales`. Esa misma estructura sale como JSON, como Excel (`exportacion/excel.ts`, una hoja por sección) y
    como PDF (`exportacion/pdf.ts`, pdfkit, tamaño carta; horizontal con más de 7 columnas), según `?formato=`.
    Un reporte nuevo es un método en `ReportesService` y su ruta: la exportación ya la tiene.
  - Las ventas de un reporte salen **siempre** de `fn_ventas_reporte` (`this.lineas(c)` para las líneas,
    `this.ventasDelReporte(c)` para los ids): ahí están el alcance por sucursal y la regla del turno abierto.
    No consultar `venta` ni `v_ventas_linea` directo, ni usar las vistas ya agrupadas por día
    (`v_ventas_diarias`, `v_cobros_metodo_diario`…): no dejan filtrar por venta.
  - Las columnas de costo se declaran con `costo: true`: la consulta las deja en null sin `REPORTES_COSTOS`
    (`veCostos()`) y `seccion()` las quita del reporte. `visible: false` quita una columna por otra razón (la
    cantidad en bodega). Los totales solo llevan columnas numéricas; en las consultas con `grouping sets` la
    fila de totales llega con `es_total = 1` y la separa `separar()`.
  - Rango (`reportes/periodo.ts`): `?periodo=dia|semana|mes` + `fecha`, o `desde` + `hasta` (hasta 366 días);
    sin nada, hoy. Días de Managua; la semana empieza el lunes. Una sucursal ajena responde 404.
  - Los dos reportes que son solo de costos (`piezas-en-paquetes` y `compras-por-proveedor`) piden
    `REPORTES_COSTOS` en la ruta. El de compras no es de ventas: sale de `v_compras` (confirmadas, por la fecha
    de la factura), no lleva sucursal y lleva la condición del permiso en su `where`. La suma de las facturas
    en su moneda solo existe por proveedor y moneda: en la fila de totales va en null.
  - En Excel los números van como números y las fechas como fechas (`horaDeManaguaEnUtc`: la hora de Managua
    escrita como si fuera UTC, porque Excel no maneja zonas). En los PDF se usan las fuentes estándar de pdfkit
    (Helvetica): solo caracteres latinos.
  - Tickets en PDF: el contenido se arma como una lista de renglones (`ventas/ticket-venta.ts`,
    `caja/ticket-cierre.ts`) y `exportacion/ticket-pdf.ts` la dibuja en una página de 80 mm de ancho y del alto
    de su contenido (primero mide en un documento aparte). `POST /api/ventas/:id/imprimir` y
    `POST /api/turnos/:id/imprimir` anotan la impresión dentro de la misma transacción que arma el PDF y
    devuelven cuál es en `X-Ticket-Impresion`. El ticket de cierre imprime lo que entrega `fn_ticket_cierre`:
    no decide nada por su cuenta.
  - `TareasService` corre `fn_alertar_cajas_sin_cerrar`, `fn_foto_inventario_mensual` y (B8)
    `fn_vencer_devoluciones` al arrancar y cada 15 minutos (un `setInterval`, sin dependencias). En las pruebas
    no corre solo: llamar a `ejecutar(ahora)`.
  - Pruebas: `test/reportes.e2e-spec.ts` trabaja en la sucursal `RPT` (las ventas antiguas se insertan directo
    en la base, porque la API siempre vende «ahora»; crea el rol `ANALISTA_RPT` y lo elimina en `afterAll`) y
    `test/tareas.e2e-spec.ts` en la sucursal `TAR`. `comoBytes` (`test/utilidades.ts`) lee un archivo
    descargado. Las pruebas de PDF solo revisan su estructura (tamaño de página, número de páginas); el
    contenido se prueba en los renglones y en el Excel. Para ver cómo queda un PDF, generarlo a un archivo
    temporal y abrirlo.
- Devoluciones y cambios (B8): módulo `devoluciones/` (rutas `/api/devoluciones...`), la casilla en
  `categorias/` (`PUT /api/categorias/:id/admite-devolucion`) y el QR en `exportacion/`.
  - Tablas `devolucion` y `devolucion_detalle` (sección 6.2 del esquema); funciones en la sección 12. Las reglas
    viven ahí: `fn_lineas_devolubles` (qué queda por devolver de cada línea y cuánto vale) y
    `fn_venta_no_devoluble` (anulada, turno abierto o plazo vencido) sirven a la búsqueda y a
    `fn_solicitar_devolucion`; `fn_proporcion_efectivo` dice qué parte de una venta se pagó en efectivo (sigue el
    «saldo por cambio» hasta la venta de origen) y de ahí sale el reparto efectivo/transferencia.
  - El «saldo por cambio» es un `metodo_pago` con `interno = true`: no sale en `/api/metodos-pago`, no se acepta
    en los `pagos` de una venta ni en el conteo del cierre, y `fn_resumen_turno` no lo cuenta. Solo lo pone
    `fn_registrar_venta` cuando la llama `fn_ejecutar_devolucion` (marca `app.ejecutando_cambio`, como
    `app.confirmando_compra`). Toda consulta nueva de pagos o cobros debe excluir `m.interno`.
  - El efectivo de una devolución **no** es un `caja_movimiento`: `fn_resumen_turno` resta
    `devolucion.monto_efectivo` del turno donde se ejecutó. `monto_total = monto_saldo + monto_efectivo +
    monto_transferencia` (CHECK).
  - `GET /api/devoluciones/venta?numero=` es la única ruta que muestra una venta de otra sucursal (hace falta
    para devolver donde aparezca el cliente): trae solo lo necesario, sin costos. Alcance de lo demás: el
    administrador ve todas; quien registra, las de sus sucursales (donde se solicitó o se ejecutó) y, por su id,
    cualquiera aprobada (`fn_puede_ver_devolucion`); una ajena responde 404. La lista no trae sumas.
  - `POST /api/devoluciones/:id/ejecutar`: el turno sale de `exigirTurno()` como en una venta. Devolución: `{}`
    (el esquema acepta que no venga cuerpo). Cambio: `items`, `pagos` y `clave_idempotencia` de la venta nueva;
    con la misma clave responde 200 `repetida: true`, y con la de otra venta, 409 `CLAVE_REUTILIZADA`.
  - `reembolso` en la devolución: `definitivo: false` es lo previsto para una devolución sin ejecutar
    (`fn_reparto_devolucion`); en un cambio sin ejecutar es null (depende de lo que se lleve el cliente).
  - Ticket de devolución: `devoluciones/ticket-devolucion.ts` (renglones) → `ticketPdf`; se anota con
    `fn_registrar_impresion_devolucion`. El renglón `{ tipo: 'qr', contenido }` de `ticket-pdf.ts` dibuja el QR
    (30 mm, `exportacion/qr.ts`); la venta trae el texto en `ticket.qr` para que la pantalla dibuje el suyo.
  - Reportes: las líneas de un reporte (`this.lineas(c)`) son las de venta **más** las devueltas en negativo
    (`v_devoluciones_linea`, con `es_devolucion`); cuáles entran lo decide `fn_devoluciones_reporte`, que recibe
    de qué sucursal se habla: `'VENTA'` (la de la venta original: ventas netas), `'CAJA'` (donde se ejecutó:
    cobros) o `'AMBAS'` (reporte de devoluciones). Contar ventas con `filter (where not l.es_devolucion)`.
  - `TareasService.ejecutar()` llama también a `fn_vencer_devoluciones` (`devoluciones_vencidas`).
  - Pruebas: `test/devoluciones.e2e-spec.ts` trabaja en las sucursales `DEA` y `DEB` (crea el rol `CAJERO_DVE` y
    lo elimina en `afterAll`); para probar el vencimiento cambia `vence_el` en la base y corre la tarea a la
    hora real. En `db/04_pruebas.sql`, para mover la fecha de una venta se desactiva `tg_venta_proteger` dentro
    de una transacción que se deshace. Una alerta de ejemplo en una prueba no debe llevar el id de un turno
    real (la tarea de cajas sin cerrar no lo alertaría): usar uno que no exista.
- Celular y PIN (backend de F1):
  - `GuardiaPermisos` recibe el equipo de la sesión: con un permiso que el rol tiene pero que no vale sin
    equipo responde 403 **`EQUIPO_REQUERIDO`**. `@SoloEnEquipo()` hace lo mismo en una ruta cuyo permiso sí
    vale en el celular (o que no pide ninguno): `GET /api/caja/turno`, imprimir tickets en papel, ejecutar una
    devolución, cerrar el equipo.
  - `/api/auth/yo` (y la respuesta del login) trae `acceso` (`COMPLETO` o `CELULAR`), `usuario.permisos` con
    **solo los que valen en esa sesión**, `usuario.pin` (`SIN_PIN`, `ACTIVO`, `BLOQUEADO`) y
    `pantalla_bloqueo_minutos`.
  - La venta resuelve su turno con `exigirTurnoParaVenta()` (`fn_turno_para_venta`), no con `exigirTurno()`:
    es lo único de la caja que se hace desde el celular. `caja_id` sirve ahí para elegir la caja abierta.
    `VentasService` recibe el `UsuarioAutenticado`: el alcance de las consultas depende del equipo.
  - `test/celular.e2e-spec.ts` **recorre todas las rutas de la API** con la sesión de celular de un rol que
    tiene todos los permisos: lo que responde tiene que estar en la lista `DESDE_EL_CELULAR`. Una ruta nueva
    que no sea del celular debe quedar bloqueada (su permiso sin marcar, o `@SoloEnEquipo()`); si sí es del
    celular, se agrega a la lista a propósito. Las rutas `@Publica()` van en `PUBLICAS`.
  - PIN: `GET /api/auth/pin/usuarios` y `POST /api/auth/pin` son públicas y dependen de la cookie del equipo;
    `PUT /api/auth/pin` crea el propio. El PIN se guarda con `hashearPassword` y su forma se valida en
    `autenticacion/esquemas.ts` (la base nunca lo ve). Entrar con PIN no lleva el límite por IP del login.
    `test/pin.e2e-spec.ts` trabaja en las sucursales `PNA` y `PNB`.
- Escrituras: siempre con `BaseDatosService.transaccion(usuarioId, async (trx) => ...)`, que fija
  `app.usuario_id` con `set_config(..., true)` (= `SET LOCAL`). Las `fn_*` se llaman con
  ``sql`select fn_x(${a}, ${b})`.execute(trx)``. Las lecturas simples pueden usar `bd.db`.
- Tipos al leer: `bigint` → number, `date` → texto `AAAA-MM-DD`, `numeric` → texto (montos exactos),
  `timestamptz` → Date. Configurado en `tipos-pg.ts` y `.kysely-codegenrc.json` (deben coincidir).
- Errores: `FiltroErrores` responde `{ codigo, mensaje }` en español. Los `RAISE EXCEPTION` de la base se
  reenvían tal cual (P0001 → 422, 42501 → 403, 23001 → 409, ESM02 → 409 `CONFIRMACION_REQUERIDA`); las violaciones de restricción generadas por
  PostgreSQL se reemplazan por texto genérico + `restriccion`. Error propio: `new HttpException({ codigo, mensaje }, estado)`.
- Pruebas: `src/**/*.spec.ts` (unitarias e integración) y `test/**/*.e2e-spec.ts` (supertest). Usan la base
  `esmeralda_api_test` (o `TEST_DATABASE_URL`), recreada desde `db/01..03` en cada corrida. Dentro de Jest
  `instanceof Error` falla con errores del núcleo de Node: revisar propiedades (`code`, `message`).
  `test/utilidades.ts` tiene `crearApp()` y `cookiePuesta()`. En SQL de prueba, una función que modifica datos
  y la lectura que la verifica van en sentencias distintas (una sentencia no ve sus propios cambios).
  Todos los archivos de prueba comparten la misma base y Jest no garantiza su orden: cada archivo e2e crea sus
  propios usuarios y equipos (`crearUsuarioDePrueba()`, `tokenDeAcceso()` y `registrarTablet()` de
  `test/utilidades.ts`) y sus propios datos; si cambia permisos de roles o parámetros, los restaura en `afterAll`.
