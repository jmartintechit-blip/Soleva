# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versiones: [SemVer](https://semver.org/lang/es/).

## [Sin publicar]

## [0.13.0] - 2026-11-09

### Añadido

- Proyección v2 desde lo que tienes hoy en el libro: inversiones a su escenario, remuneradas con sus tramos, promoción y retención, inmuebles con su revalorización, coche por la tabla de Hacienda, bienes por su curva, productos estimados a su rentabilidad y deudas con su cuadro (las variables y mixtas se revisan con el Euríbor de hoy).
- Horizonte de 5, 10, 20 o 30 años, euros de hoy o de entonces y escenario prudente, base u optimista, todo en vivo; línea con banda prudente–optimista e hitos.
- «De dónde sale» (lo que tienes hoy, lo que aportas, la rentabilidad, lo que pierde valor, lo que cuestan las deudas y, en euros de hoy, lo que se come la inflación), «Por tipo» y «Lo que va a pasar»: fin de una promoción, revisión de la hipoteca con la cuota nueva, deuda pagada y fin de una regla.
- Supuesto «Tus ingresos y gastos»: cuánto suben al año los ingresos y gastos de tus reglas (por defecto, la inflación).
- «Cómo voy»: fija la proyección como tu plan y compara lo previsto para hoy con lo que tienes, con el porqué en tres filas; también como aviso en Inicio.
- «¿Qué pasa si…?»: aportar más cada mes, pausar un plan o un gasto único, con la proyección de siempre como línea fantasma y un atajo a la regla ya rellena.
- Amortizar o invertir: el mismo dinero en dos columnas iguales (intereses que te ahorras, fecha de pagada o cuota nueva, lo que valdría invertido y tu patrimonio), sin recomendar ninguna.
- «Mi plan» en la exportación de datos.

### Cambiado

- La proyección anterior (por saldos y reglas v0) se retira.

### Seguridad

- Dependencia de desarrollo `minimatch` actualizada a 11.0.5.

## [0.12.0] - 2026-11-05

### Añadido

- Reglas que generan movimientos: transferencias, ingresos, gastos y cuotas, de semanal a anual o una sola vez, con fecha de inicio y de fin. Una regla puede ser de un inmueble, coche o bien y se para con su baja.
- Planes de inversión con varios productos, día y cuenta, la media de cada mes, aviso si pasa de lo que entra y qué hacer sin efectivo suficiente.
- Cuenta remunerada con tramos, promoción, día de pago, base 365 o 360 y retención; los intereses brutos, la retención y los netos del mes.
- Hipotecas y préstamos, fijos o variables (Euríbor más diferencial, revisión y suelo), desde lo que te queda por pagar o desde los datos originales: próxima cuota en intereses y capital y cuadro de amortización.
- Vivienda o inmueble por los m² de su municipio (valor tasado medio del Ministerio de Vivienda, actualizado con el índice de precios de vivienda del INE de su comunidad) o por tu valor, con su hipoteca enlazada y lo que es tuyo de verdad. Nunca pide la dirección.
- Coche o moto por la tabla de Hacienda (o tu valor) y otros bienes con su pérdida de valor por años.
- Productos sin precio público con la rentabilidad estimada que pongas tú.
- Dar de baja un inmueble, coche, bien o deuda desde una fecha («Lo vendí o ya no lo tengo»), con la venta en la cuenta que elijas y la hipoteca liquidada, mantenida o borrada; deshacer la baja; o borrar lo añadido por error.
- Paso al libro de movimientos al entrar: tus cuentas pasan con el mismo valor, comprobado cuenta a cuenta, y si algo no cuadra no se cambia nada.
- Recordatorio mensual para cuadrar tus cuentas.

### Cambiado

- El cierre de mes da paso al cuadre: las rutas del cierre llevan a Cuentas.
- Una cuenta nueva entra siempre por el alta inicial.
- Un inmueble o vehículo de antes sin sus datos muestra solo «Completa sus datos», sus movimientos, la baja y el borrado, sin los controles de un bróker.
- Los interruptores apagados tienen un borde visible en los tres temas.

### Corregido

- Una cuenta remunerada abierta el día de pago cuenta el interés de ese primer día.

## [0.11.0] - 2026-10-31

### Añadido

- Inicio nuevo: patrimonio con su gráfico por día, mes, 3 y 6 meses, año o todo; lo que aportaste frente a lo que ganó tu dinero (rentabilidad ponderada por dinero), la alerta principal, cada cuenta con lo que ganó y el reparto por tipo. El interés devengado y no pagado ya cuenta en el valor.
- Navegación nueva: Inicio, Cuentas, Proyección y Reglas abajo en el móvil; en escritorio, además, Alertas con contador y Ajustes.
- Alertas con sus cifras, su acción y «Ocultar».
- Cuenta: posiciones con cantidad, precio, valor y ganancia; efectivo con su interés; el plan de la cuenta y sus movimientos (automáticos y de cuadre).
- Añadir producto: buscador por nombre, ISIN o ticker con una fila por producto, su ISIN (registro FIRDS de ESMA) y la bolsa en euros primero; las participaciones y el precio medio dan el valor y la ganancia al momento. Si ya lo tienes, se suma a tu posición.
- Cuadre: lo que Soleva cree que tienes frente a lo real; cada diferencia queda apuntada como ajuste de hoy.
- Alta inicial en tres pasos, sin barra inferior, con el total al momento.
- Planes de inversión sin efectivo suficiente: no se compra y se avisa, o se trae el importe desde otra cuenta. El efectivo de un bróker nunca queda en negativo.

### Cambiado

- Todo saldo negativo sale en rojo y con «−» en todas las pantallas.
- La búsqueda de productos no espera al ISIN: aparece en cuanto llega y se guarda para la próxima vez.

Las pantallas nuevas son para quien ya está en el libro de movimientos; los usuarios actuales pasan a ellas con las reglas nuevas (bloque 12).

## [0.10.0] - 2026-10-30

### Añadido

- Datos de mercado detrás de un único adaptador: cierres diarios de bolsa, tipos de cambio de referencia del BCE y Euríbor oficial mensual del Banco de España, con caché, reintentos y precio manual de respaldo.
- Buscador de instrumentos por nombre, ISIN o ticker, en el orden de la búsqueda, sin rankings propios.
- Ejecución diaria: el cron de las 07:00 actualiza los datos compartidos y encola una tarea por usuario; cada una genera lo que toca, recoloca compras provisionales, guarda el histórico y abre o resuelve alertas.
- Tablas de Hacienda de 2026 (Orden HAC/1501/2025): 62.663 modelos de coche y moto y los porcentajes por años de uso, con un comando anual para cargar la orden de cada año.

### Cambiado

- Las alertas y la lectura de datos son incrementales: cada ejecución solo recalcula lo que ha cambiado desde la anterior. En Workers, un usuario de 80 cuentas pasa de 272–393 ms a 55–126 ms de CPU por día.

### Corregido

- Dos tests intermitentes, en su causa: el E2E de Ajustes fallaba si quedaba un código de acceso sin usar, y el test de migraciones superaba el tiempo límite en el CI.

## [0.9.0] - 2026-10-30

### Añadido

- Motor diario (funciones puras, sin interfaz todavía): genera cada día ingresos, transferencias, gastos y cuotas, compras de planes de inversión semanales a anuales en varios productos (al cierre de ese día; los sábados y domingos, el lunes), cuotas de deudas, dividendos con su retención e intereses.
- Intereses calculados cada día sobre el saldo real de cierre, con tramos, fin de promoción y retención del 19 %.
- Deudas por el sistema francés, a tipo fijo o con Euríbor, diferencial, revisiones y suelo; los intereses son gasto y el capital amortizado reduce la deuda.
- Nunca dos veces: si el motor se salta días, al recuperarlos da exactamente lo mismo que ejecutándose a diario.
- Valoración en euros con el cambio del BCE, cantidades con 8 decimales, productos sin precio público como estimación, coche con las tablas de Hacienda y bienes con su curva.
- Rentabilidad ponderada por dinero (TIR) separando lo que aportas de lo que gana tu dinero; reparto por tipo de activo.
- Alertas: cuenta que se queda sin saldo, plan que gasta más de lo que entra, fin de una promoción y precio sin actualizar.
- Cuadre con el saldo o las participaciones reales y recolocación de compras provisionales.
- Test de aceptación con un caso de referencia completo (importes inventados).

## [0.8.0] - 2026-10-30

### Añadido

- Base del libro de movimientos: cada cuenta tendrá su historial de ingresos, gastos, transferencias, compras, ventas, dividendos, intereses y ajustes, del que salen saldos y posiciones. Solo se añaden movimientos (un error se anula y se apunta de nuevo) y cada compra guarda su lote, para poder calcular por FIFO más adelante.
- La base de datos garantiza que una transferencia entre cuentas propias suma cero y nunca cambia el patrimonio.
- Instrumentos (ETF, fondos, acciones, ETC, cripto y productos sin precio público) con precios diarios, tipos de cambio del BCE y splits; cantidades con 8 decimales.
- Reglas que generarán movimientos en su fecha: transferencias, ingresos, gastos y planes de inversión en varios productos, semanales a anuales.
- Intereses por tramos con fin de promoción y retención, dividendos, deudas (sistema francés, fijas o con Euríbor), coche con las tablas de Hacienda y bienes con curva de depreciación.
- Alertas e históricos diario y mensual.
- Acceso a cada cuenta a través de una tabla de permisos (propietario, editor, lector), preparada para cuentas compartidas.
- Paso de los datos actuales al libro sin perder nada (probado, se ejecutará al estrenar las pantallas nuevas).
- La exportación incluye todo lo nuevo.

### Cambiado

- Escritorio: el contenido se centra y Cierre, mes cerrado, Inicio y Ajustes usan dos columnas.
- Importes con decimales solo cuando no son cero, igual en toda la app.
- Mes cerrado: botón «Corregir» visible en cada saldo. «Borrar mi cuenta» es un botón rojo, aparte y con confirmación.
- Exportación en euros; el CSV usa «;» y coma decimal, como lo abre Excel en español.
- El sol del logo se anima una sola vez al cargar la app.

## [0.7.0] - 2026-10-29

### Añadido

- Ajustes: tema Amanecer, Crepúsculo o Rosé (por dispositivo; la marca y la web siguen en Amanecer), día del recordatorio (1–28) o apagarlo.
- Exportar todo lo apuntado: un JSON completo o un CSV por tabla (cuentas, reglas, cierres, correcciones y ajustes), importes en céntimos.
- Borrar la cuenta de verdad: en cascada con sesiones, cierres y códigos de acceso pendientes, con test.
- Cerrar sesión en este o en todos los dispositivos.

### Cambiado

- Ajustes entra en la barra inferior del móvil.

## [0.6.0] - 2026-10-29

### Añadido

- Cierre de mes: Soleva propone los saldos a partir de tus reglas e intereses; los corriges en línea y confirmas todo de una vez, con el conteo desde el mes anterior.
- Un mes cerrado no se edita: cada corrección posterior queda como enmienda con su motivo y el saldo anterior, también en base de datos (triggers).
- Histórico de meses cerrados con su detalle y sus enmiendas.
- Inicio: evolución del patrimonio de los últimos 12 meses, cambio desde el último cierre y acceso «Cierra {mes}».
- Recordatorio por email el día del mes que toque (por defecto el 1), una sola vez por mes abierto, desde un cron diario.

## [0.5.0] - 2026-10-29

### Añadido

- Lista de espera abierta en solevaapp.com.
- Inicio: patrimonio de hoy con conteo, semáforo, estimación a 10 años y tus cuentas.
- Proyección (móvil y escritorio): escenarios prudente, base y optimista, horizonte de 5, 10 o 20 años, gráfico con rango, «tú aportas / pone la rentabilidad» y tres «¿qué pasa si…?» que recalculan en vivo.
- Supuestos editables por usuario y «Fijar como mi plan» para el semáforo («Vas en camino» / «Algo por debajo del plan», umbral −3 %).

### Cambiado

- En «Nueva regla», Día, Desde y Hasta van plegados en «Más opciones» (por defecto: hoy, este mes, sin fin).
- El job «Free-plan usage» dice en rojo si es el AVISO de consumo o un fallo del script.

## [0.4.0] - 2026-10-29

### Añadido

- Cuentas: crear, editar, archivar y borrar, con saldo en céntimos, valor estimado e interés o depreciación anual (vehículo −15 % por defecto).
- Reglas: listado con interruptor de pausa y hoja «Nueva regla» con plantillas (nómina, gastos fijos, aportación), importe con deslizador, frecuencia, día, desde y hasta, y su efecto estimado a 10 años.
- Importes y porcentajes escritos a la española (`1.250,50`) o con punto decimal.
- Aislamiento por usuario en base de datos: claves foráneas compuestas y 404 para cuentas y reglas ajenas, con tests.

## [0.3.0] - 2026-10-29

### Añadido

- Motor: meses y recurrencias (mensual, trimestral, anual, una vez; día 31 al último día del mes), reglas ordenadas por día, intereses y depreciación por cuenta, patrimonio = activos − deudas.
- Motor: proyección mes a mes en euros de hoy y del momento por escenario, semáforo del plan (umbral −3 %) y tres «¿qué pasa si…?» (más al mes, pausar aportaciones, gasto puntual).
- Tests de invariantes: un traspaso no cambia el patrimonio, los pagos a deudas se topan a lo que se debe e importes siempre en céntimos enteros.
- Aviso legal completo: titular, encaje con la Ley 6/2023 (sin asesoramiento), condiciones de uso, responsabilidad y ley aplicable.
- Política de privacidad completa: responsable, bases legales, plazos, encargados y cookie de sesión.

### Cambiado

- Las sesiones ya no guardan la IP ni el navegador, y la IP de los límites de intentos se borra a partir de los 10 minutos.

## [0.2.0] - 2026-10-28

### Añadido

- Portada pública: titular, vista previa de la proyección, pilares, cómo funciona y privacidad.
- Calculadora de interés compuesto en euros de hoy con escenarios prudente, base y optimista.
- Motor: interés compuesto en céntimos y formato español de euros, con tests.
- Lista de espera con consentimiento, doble confirmación por email y baja que borra el email; cerrada en producción (`WAITLIST_OPEN`).
- Aviso legal y política de privacidad en borrador, con los huecos marcados.
- Imagen para compartir enlaces (1280×640).

### Cambiado

- Better Auth se crea una vez por isolate: la mediana de CPU por petición baja de 11 ms a 1,5 ms.
- El aviso de consumo vigila la mediana de CPU en lugar del p99.

## [0.1.0] - 2026-10-28

### Añadido

- Esqueleto con SvelteKit 3 y Svelte 5 para Cloudflare Workers.
- Sistema de diseño Horizonte con las fuentes Geist alojadas en el propio sitio.
- Base de datos Neon Postgres (Frankfurt) con migraciones SQL numeradas y PGlite en los tests.
- Entrada con código de un solo uso por email (Better Auth + Resend), con límite de intentos guardado en la base de datos.
- Página de entrada, rutas privadas con guarda de sesión, navegación inferior en móvil y lateral en escritorio, y página de error en español.
- Política de seguridad de contenidos (CSP) con nonce, HSTS y otras cabeceras de seguridad.
- `npm run usage`: consumo frente a los planes gratuitos de Workers y Neon, con aviso al 70 % y al 90 %.
- CI en GitHub Actions: lint, tipos, formato, tests y build en cada push.
- Registro cerrado a una lista de emails (`ALLOWED_EMAILS`) y `noindex` en toda la app hasta la beta.
- Prueba E2E de entrada con Playwright, en CI sobre una rama temporal de Neon copiada de dev.
- Primer despliegue en Cloudflare Workers.

[Sin publicar]: https://github.com/jmartintechit-blip/soleva/compare/v0.13.0...HEAD
[0.13.0]: https://github.com/jmartintechit-blip/soleva/releases/tag/v0.13.0
[0.12.0]: https://github.com/jmartintechit-blip/soleva/releases/tag/v0.12.0
[0.11.0]: https://github.com/jmartintechit-blip/soleva/releases/tag/v0.11.0
[0.10.0]: https://github.com/jmartintechit-blip/soleva/releases/tag/v0.10.0
[0.9.0]: https://github.com/jmartintechit-blip/soleva/releases/tag/v0.9.0
[0.8.0]: https://github.com/jmartintechit-blip/soleva/releases/tag/v0.8.0
[0.7.0]: https://github.com/jmartintechit-blip/soleva/releases/tag/v0.7.0
[0.6.0]: https://github.com/jmartintechit-blip/soleva/releases/tag/v0.6.0
[0.5.0]: https://github.com/jmartintechit-blip/soleva/releases/tag/v0.5.0
[0.4.0]: https://github.com/jmartintechit-blip/soleva/releases/tag/v0.4.0
[0.3.0]: https://github.com/jmartintechit-blip/soleva/releases/tag/v0.3.0
[0.2.0]: https://github.com/jmartintechit-blip/soleva/releases/tag/v0.2.0
[0.1.0]: https://github.com/jmartintechit-blip/soleva/releases/tag/v0.1.0
