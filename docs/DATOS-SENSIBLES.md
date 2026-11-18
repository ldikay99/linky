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
| Cookie de sesión de la web y token CSRF | Linky | Secreto | Navegador; en la base solo el hash | `httpOnly`, `SameSite=Strict`, `Secure`; se redactan de los logs |
| Conversaciones del chat | Linky web | Personal confidencial | Base de datos de la web | AES-256-GCM, clave por persona y propósito (HKDF), id del registro como dato asociado |
| Adjuntos y fotos de evidencia | Persona | Personal confidencial | Carpeta de adjuntos de la web | Un archivo cifrado por adjunto, permisos `0600`; tipo real verificado por contenido |
| Memoria y fragmentos de conversaciones (texto y vectores) | Linky web | Personal confidencial | Base de datos de la web | Cifrados como las conversaciones; la memoria rechaza lo que parezca un token |
| Eventos del calendario | Google Calendar | Personal confidencial | Solo en memoria durante la consulta | El ZIP exportado se borra al leerlo |
| Correos del día (asunto, personas, fragmento) | Gmail | Personal confidencial | Solo en memoria durante la consulta | No se descarga el cuerpo completo |
| Previews de escrituras (`last-*.json`) | Linky | Personal confidencial | `~/.linky` | Permisos `0600`, carpeta `0700`, fuera del repositorio |
| Bitácora de Ripor y control de duplicados | Linky | Personal confidencial | `~/.linky` | Igual que los previews |
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
