# Datos sensibles: clasificación, cifrado, retención y borrado

Clasificación de cada dato que Linky toca (ver `FUENTES-DE-DATOS.md`), dónde vive hoy y cómo se protege. Sobre esta
base se definen las reglas de cifrado, retención y borrado de la versión multiusuario.

## Niveles

| Nivel | Qué es | Regla general |
|---|---|---|
| **Secreto** | Da acceso a una cuenta en nombre de la persona | Nunca en claro en disco, logs, base de datos, repositorio ni mensajes; nunca se muestra después de guardarse |
| **Personal confidencial** | Contenido del trabajo o la comunicación de una persona | Cifrado por persona; solo la persona lo ve |
| **Interno** | Configuración y metadatos sin contenido personal | Protegido por permisos de archivo o de la base; visible para la persona y, si aplica, para el administrador |
| **Público** | Código y documentación de Linky | Repositorio |

## Clasificación

| Dato | Fuente | Nivel | Dónde vive hoy | Protección actual |
|---|---|---|---|---|
| Token personal de Azure (PAT) | Azure DevOps | Secreto | Llavero del sistema o bóveda cifrada | Llavero del sistema operativo; en servidor, AES-256-GCM con clave derivada por persona |
| Cookie de sesión de Azure | Azure DevOps | Secreto | Llavero | Igual que el PAT |
| Cookies de sesión de Ripor | Ripor | Secreto | Llavero | Igual que el PAT |
| Sesión de Google (perfil del navegador de Linky) | Google | Secreto | Perfil del navegador en `~/.linky` | Carpeta de la persona fuera del repositorio |
| Clave maestra de la web | Linky | Secreto | Llavero, variable de entorno o secreto de Docker | Nunca se escribe en la base ni en los datos |
| Cookie de sesión de la web y token CSRF | Linky | Secreto | Navegador; en la base, el hash del id de sesión y el CSRF | `httpOnly`, `SameSite=Strict`, `Secure`; se redactan de los logs |
| Conversaciones del chat | Linky web | Personal confidencial | Base de datos de la web | AES-256-GCM, clave por persona y propósito (HKDF), id del registro como dato asociado |
| Adjuntos y fotos de evidencia | Persona | Personal confidencial | Carpeta de adjuntos de la web | Un archivo cifrado por adjunto, permisos `0600`; tipo real verificado por contenido |
| Memoria y fragmentos de conversaciones (texto y vectores) | Linky web | Personal confidencial | Base de datos de la web | Cifrados como las conversaciones; la memoria rechaza lo que parezca un token |
| Eventos del calendario | Google Calendar | Personal confidencial | Solo en memoria durante la consulta | El ZIP exportado se borra al leerlo |
| Correos del día (asunto, personas, fragmento) | Gmail | Personal confidencial | Solo en memoria durante la consulta | No se descarga el cuerpo completo |
| Previews de escrituras (`last-*.json`) | Linky | Personal confidencial | `~/.linky` | Fuera del repositorio; permisos `0600` salvo dos previews (ver Brechas) |
| Bitácora de Ripor y control de duplicados | Linky | Personal confidencial | `~/.linky` | Fuera del repositorio; control de duplicados con `0600`, bitácora sin permisos propios (ver Brechas) |
| Adjuntos de reuniones descargados | Google Drive | Personal confidencial | `~/.linky/evidence/<fecha>/` | Fuera del repositorio; carpeta `0700` |
| Perfil (rol, proyecto, horario) | Persona | Interno | `~/.linky/profile.json` | Permisos `0600` |
| Organizaciones de Azure y vencimiento del token | Linky | Interno | `~/.linky/azure-orgs.json` | Permisos `0600`; sin el token |
| Formato aprobado de HU y Tasks | Persona | Interno | `~/.linky/azure-style.json` | Permisos `0600` |
| Clasificación de reuniones | Persona | Interno | `~/.linky/calendar.json` | Permisos `0600` |
| Repositorios y correos de autor | Persona | Interno | `~/.linky/dev.json` | Permisos `0600`; remotos sin credenciales |
| Auditoría de acciones | Linky web | Interno | Base de datos de la web | Solo acción, resultado y fecha; sin contenido |
| Código, skills y documentación | Linky | Público | Repositorio | Escáner de secretos en el pre-commit |

## Lo que sale de Linky

| Destino | Qué recibe | Nivel |
|---|---|---|
| Azure DevOps y Ripor | Lo que la persona aprueba en el preview | Personal confidencial (queda en el sistema de la empresa) |
| Proveedor de IA | Mensajes, adjuntos enviados y resultados de herramientas del turno | Personal confidencial; nunca secretos |
| Google Chat | Mensaje de inicio o cierre aprobado | Personal confidencial |

## Cifrado

Cada parte separa lo que **hay hoy** (sale del código) de las **reglas a implementar** para el servidor del área.

### En reposo

Hoy:

| Dato | Cómo se cifra | Clave |
|---|---|---|
| Títulos, transcripciones e historial de conversaciones | AES-256-GCM, IV aleatorio de 12 bytes, id del registro como dato asociado | Clave `data` de la persona |
| Aprobaciones pendientes y nombres de adjuntos | Igual | Clave `data` de la persona |
| Memoria y fragmentos (texto y vector) | Igual; el vector también se cifra | Clave `data` de la persona |
| Contenido de adjuntos | Un archivo `.bin` cifrado por adjunto | Clave `files` de la persona |
| Secretos de Linky en servidor (PAT, cookies de Azure y Ripor) | Bóveda `secrets/vault.json`, AES-256-GCM, nombre del secreto como dato asociado | Clave `vault` de la persona, solo por entorno |
| Secretos de Linky en el equipo de la persona | Llavero del sistema operativo | La del sistema |

- Las claves por persona salen de la clave maestra con HKDF-SHA256 (sal: id de la persona; contexto: propósito y versión).
- Cada dato cifrado lleva un byte de versión: el formato admite cambiar de algoritmo o de clave.
- Quedan en claro en la base: ids, fechas, rol, nombre y correo de la persona; tipo, tamaño y huella SHA-256 de cada
  adjunto; estado de las aprobaciones; y la auditoría (acción, resultado, conteos).
- El archivo de la base (SQLite, modo WAL) no va cifrado como un todo: se protege el contenido, no los metadatos.

Reglas a implementar:

| Regla | Por qué |
|---|---|
| Disco del servidor cifrado (volumen completo) | Cubre metadatos, WAL, temporales y perfiles del navegador si alguien se lleva el disco |
| En PostgreSQL, el contenido se sigue cifrando en Linky (columnas `bytea`), no en la base | La clave nunca viaja en consultas ni queda en logs de la base |
| Envoltura de claves: una clave aleatoria por persona, cifrada con la maestra | Permite borrar a una persona destruyendo su clave (también en respaldos) y rotar la maestra sin recifrar todo |
| Copias descifradas de adjuntos solo en memoria o en un temporal que se borra al terminar la herramienta | Hoy quedan en disco (ver Brechas) |

### En tránsito

Hoy:

- Fuera de loopback la web no arranca sin `LINKY_WEB_PUBLIC_URL` en `https` (detrás de un proxy TLS).
- Con `https` se envía HSTS de un año con subdominios; la cookie de sesión siempre es `Secure`.
- En Docker el puerto se publica solo en el loopback del anfitrión.
- Azure DevOps (solo acepta organizaciones `https`), Ripor y Google se consultan por `https`.

Reglas a implementar:

| Regla | Por qué |
|---|---|
| El proxy acepta solo TLS 1.2 o superior, con certificado de la empresa | Red interna del área, sin texto en claro |
| Proxy y Linky en el mismo anfitrión o en red privada; Linky sin puerto expuesto | El tramo sin TLS no sale de la máquina |
| Conexión a PostgreSQL con TLS y verificación del certificado (`verify-full`) | La base puede vivir en otro servidor |

### Gestión y rotación de claves

Hoy:

- Clave maestra de 32 bytes: por `LINKY_WEB_MASTER_KEY`, por archivo (`LINKY_WEB_MASTER_KEY_FILE`, secreto de Docker) o,
  en el equipo de la persona, por el llavero del sistema (se crea la primera vez).
- En modo `multi` o con bóveda, la web no arranca sin clave maestra por entorno.
- `docker:init` la crea una sola vez con permisos `0600`, no la imprime y no la reemplaza: cambiarla deja ilegibles
  los datos.
- Las claves derivadas viven solo en la memoria del proceso; la de la bóveda pasa al CLI por variable de entorno.
- No hay rotación implementada.

Reglas a implementar:

| Clave | Custodia | Rotación |
|---|---|---|
| Clave maestra | Gestor de secretos del servidor; copia fuera de línea, separada de los respaldos de datos; acceso solo del admin | Cada año y ante sospecha de exposición: versión nueva, recifrado por lotes; la anterior se destruye al terminar |
| Clave por persona (con envoltura) | Cifrada con la maestra, en la base | Se reenvuelve al rotar la maestra; se destruye al borrar la cuenta |
| PAT de Azure | Bóveda de la persona | La fija Azure (se recomienda 90 días); Linky avisa antes de que venza |
| Sesiones de Ripor y Google | Bóveda o perfil de la persona | Las fija cada servicio; se borran al desconectar |

### Lo que nunca se guarda

| Dato | Cómo se evita hoy |
|---|---|
| PAT, cookies y sesiones de servicios en claro | Llavero o bóveda cifrada; la bóveda no escribe su clave a disco |
| Clave maestra en la base o en los datos | Solo entorno, archivo de secreto o llavero |
| Id de sesión e invitaciones en claro | En la base solo su hash SHA-256 |
| Secretos en la memoria | Se rechaza lo que parezca un token, una clave privada o una contraseña |
| Cookies, `authorization` y CSRF en los logs | El logger los redacta |
| Trazas y rutas internas en respuestas de error | Solo se devuelve un mensaje corto y conocido |

## Retención

**Propuesta a aprobar por el responsable del área.** La Ley 1581 de 2012 pide tratar los datos personales solo para su
finalidad y con medidas de seguridad (art. 4), y da a la persona el derecho de pedir su supresión (art. 8). El registro
oficial del trabajo vive en Azure DevOps y Ripor; Linky guarda una copia de trabajo y la conserva solo mientras sirve
para registrar o corregir.

| Dato | Hoy | Propuesta | Por qué |
|---|---|---|---|
| Sesión de la web | Vence a los 7 días (configurable); se purga cada hora y al cerrar sesión | 7 días máximo y cierre tras 12 h sin uso | Una jornada sin volver a entrar; el campo de último uso ya existe |
| Invitación | Aún sin uso en la web; la tabla se purga al usarse o al vencer | 72 h, un solo uso | Alcanza para activar la cuenta sin dejar enlaces vivos |
| Conversación (con aprobaciones y fragmentos) | Sin plazo; la lista muestra solo las 200 más recientes | 12 meses desde su última actualización | Cubre correcciones de meses anteriores; el registro oficial queda en Azure y Ripor |
| Recuerdos de la memoria | Sin plazo; la persona los borra | Mientras la cuenta exista | Son preferencias de trabajo, no contenido del día; la persona los ve y borra |
| Adjuntos y fotos de evidencia | Sin plazo | 12 meses desde la carga, o antes si se borra la conversación que los usa | La evidencia aprobada ya quedó adjunta en Azure o Ripor |
| Copias descifradas de adjuntos (`scratch/evidence`) | Sin plazo | Se borran al terminar la herramienta; máximo 24 h | Están en claro |
| Preview del día en la web (`scratch/preview-*.json`) | Sin plazo | Se borra al aplicar o rechazar; máximo 7 días | Solo sirve para esa aprobación |
| Previews del CLI (`last-*.json`) | Se reemplazan con el siguiente preview del mismo tipo | Se borran al aplicar; máximo 7 días | Igual |
| Bitácora de Ripor | Crece sin límite | Entradas cerradas: 90 días. Pendientes o inciertas: hasta conciliarlas | Las abiertas bloquean escrituras a ciegas; las cerradas sirven para revisar el mes |
| Control de duplicados y registro de mensajes de Chat | Sin plazo | 90 días | Evita repetir escrituras del mes en curso y del anterior |
| Adjuntos de reuniones (`~/.linky/evidence/<fecha>/`) | Sin plazo | 30 días | Se usan para registrar ese día |
| ZIP de calendario | Se lee en memoria y se borra al terminar | Igual (0 días) | Trae el calendario completo de la persona |
| Perfil del navegador de Linky | Mientras exista la carpeta | Mientras la conexión esté activa; se borra al desconectar o al retirar a la persona | Contiene la sesión de Google |
| Tokens y sesiones de servicios | Hasta desconectar o vencer | Igual | Los fija cada servicio |
| Auditoría | Sin plazo | 12 meses | Trazabilidad de escrituras y accesos para el cierre anual; no tiene contenido |
| Logs del servidor | En Docker, rotación de 3 archivos de 10 MB | 30 días como máximo | Diagnóstico, sin secretos |
| Respaldos | No hay | 30 días, rotativos | Ver Borrado |

La purga de lo que tenga plazo corre sola en el servidor, como hoy la de sesiones e invitaciones.

## Borrado

### Lo que borra la persona

Hoy:

| Acción | Qué borra | Qué no borra |
|---|---|---|
| Borrar una conversación | La conversación, sus aprobaciones y sus fragmentos de memoria (en cascada) | Sus adjuntos y el preview del día en `scratch` |
| Borrar un recuerdo o todos | Los recuerdos de la persona | Los fragmentos (se van con su conversación) |
| Borrar mis datos | Todas las conversaciones (con aprobaciones y fragmentos), registros y archivos cifrados de adjuntos y la carpeta `scratch`; deja el conteo en la auditoría | Recuerdos, sesiones, cuenta y el espacio de Linky (bóveda, perfiles del navegador, previews, bitácora, adjuntos de reuniones) |
| Desconectar Azure | El PAT de esa organización y su registro | El token sigue vivo en Azure hasta que la persona lo revoque |
| Desconectar Ripor | La sesión guardada | La sesión en ripor.co hasta cerrarla allá |
| Desconectar Google | Cierra la sesión en Google desde el perfil | La carpeta del perfil |

Reglas a implementar:

- "Borrar mis datos" también borra recuerdos, previews y adjuntos de reuniones descargados.
- Borrar una conversación borra los adjuntos que solo ella usa y su preview del día.
- Desconectar Google o Ripor borra la carpeta del perfil del navegador correspondiente.

### Lo que borra el admin al retirar a alguien

Hoy no existe: no hay desactivación ni borrado de cuentas. Regla a implementar:

1. **Desactivar** de inmediato: la cuenta no inicia sesión y se borran sus sesiones abiertas.
2. **Avisar a la persona** que revoque su PAT en Azure DevOps y cierre Ripor y Google en cada servicio; Linky no puede
   revocarlos por ella.
3. **Borrar la cuenta completa** en 15 días hábiles como máximo (el plazo de la Ley 1581 para atender un reclamo,
   art. 15), salvo que el responsable pida conservarla por un motivo documentado.

### Borrado de cuenta completa

Regla a implementar. Borra en una sola operación:

| Dónde | Qué |
|---|---|
| Base | La fila de la persona; en cascada, sus sesiones, invitaciones, conversaciones, adjuntos, aprobaciones y memoria (las tablas ya tienen `ON DELETE CASCADE`) |
| Disco | `files/<id>/`, `scratch` y `users/<id>/` completo: bóveda, perfiles del navegador, previews, bitácora, adjuntos de reuniones |
| Claves | Su clave por persona (con envoltura), para que lo que quede en respaldos no se pueda leer |
| Auditoría | Se conserva sin datos de la persona: solo el id interno, que ya no se asocia a nadie |

### Cómo se verifica

Regla a implementar:

- Al terminar, Linky cuenta lo que queda de esa persona en cada tabla y carpeta; todo debe dar cero.
- La auditoría registra quién borró, cuándo y los conteos, sin contenido.
- Una prueba automática crea una persona con datos en cada tabla y carpeta, la borra y comprueba que no queda nada.

### Respaldos

Hoy no hay respaldos automáticos (el criterio CA-9 de `ALCANCE.md` los pide). Regla a implementar:

- Respaldo diario de la base y de los adjuntos. El contenido ya va cifrado; el respaldo se cifra otra vez con una clave
  distinta de la maestra.
- La clave maestra se respalda aparte: un respaldo sin ella no se puede leer.
- Se conservan 30 días. Un dato borrado desaparece de los respaldos cuando vence el último que lo tenía, y antes si se
  destruye su clave por persona.
- Al restaurar, se vuelven a aplicar los borrados de cuenta hechos después del respaldo (salen de la auditoría).
- Una restauración de prueba cada trimestre.

## Brechas

Lo que hoy no cumple las reglas de este documento. Cada fila es una Task por crear.

| Brecha | Dónde | Task que la cierra |
|---|---|---|
| `last-preview.json` y `last-ripor-delete-preview.json` se escriben sin permisos `0600` | `agent/lib/cli/main.ts` | Escribir todos los previews con `0600` |
| La bitácora de Ripor se escribe sin permisos `0600` y crece sin límite | `agent/lib/ripor/journal.ts` | Permisos `0600` y purga de entradas cerradas |
| El token CSRF se guarda en claro en la base | `web/server/store/db.ts` | Guardar su hash o derivarlo del id de sesión |
| Las copias descifradas de adjuntos quedan en `scratch/evidence` | `web/server/linky/tools.ts` | Borrarlas al terminar la herramienta |
| El preview del día de la web queda en `scratch` | `web/server/linky/tools.ts` | Borrarlo al aplicar o rechazar |
| Borrar una conversación no borra sus adjuntos | `web/server/store/db.ts` | Asociar adjuntos a la conversación y borrarlos con ella |
| "Borrar mis datos" no borra recuerdos ni el espacio de Linky | `web/server/routes.ts` | Ampliar el borrado según esta regla |
| Las conversaciones más allá de las 200 recientes no se ven ni se borran desde la web | `web/server/store/db.ts` | Paginación y purga por plazo |
| No hay plazos de retención fuera de sesiones e invitaciones | `web/server/index.ts` | Purga programada con los plazos aprobados |
| No hay cierre de sesión por inactividad | `web/server/security/auth.ts` | Usar el último uso de la sesión |
| No hay desactivación ni borrado de cuenta | `web/server/store/db.ts`, `web/server/routes.ts` | Desactivar, borrar y verificar según esta regla |
| Las claves por persona se derivan de la maestra: no se destruyen por separado | `web/server/security/crypto.ts` | Envoltura de claves por persona |
| No hay rotación de la clave maestra | `web/server/security/crypto.ts` | Rotación con versión de clave y recifrado por lotes |
| No hay respaldos | Despliegue | Respaldo diario cifrado, retención y prueba de restauración |
| La huella SHA-256 de cada adjunto queda en claro: permite confirmar si alguien subió un archivo conocido | `web/server/store/db.ts` | Cifrarla o reemplazarla por un HMAC con clave de la persona |
| En Windows, Node no aplica los permisos `0600` y `0700`; protege el perfil del usuario del sistema | `agent/`, `web/server/` | Documentarlo en la instalación en el equipo; en Docker (Linux) sí aplican |
