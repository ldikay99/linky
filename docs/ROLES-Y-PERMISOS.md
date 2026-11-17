# Roles, permisos y aprobación de escrituras

Linky trabaja con tres roles. Cada persona tiene uno, y el rol solo amplía lo que se puede administrar: nadie registra
ni lee el trabajo de otra persona en su nombre.

## Roles

| Rol | Quién | Para qué |
|---|---|---|
| Usuario | Cada persona del área de Datos | Registrar su propio día. |
| Líder | Líder del área | Hacer seguimiento del cumplimiento del registro de su equipo. |
| Administrador | Responsable de Linky en el área | Gestionar las cuentas y la operación del servidor. |

## Permisos

| Acción | Usuario | Líder | Administrador |
|---|---|---|---|
| Conversar con el asistente y adjuntar evidencias | Sí | Sí | Sí |
| Conectar sus propias cuentas (Azure DevOps, Google, Ripor) | Sí | Sí | Sí |
| Ver y aprobar las vistas previas de sus registros | Sí | Sí | Sí |
| Ver sus conversaciones, memoria y adjuntos | Sí | Sí | Sí |
| Ver qué días le faltan por registrar a cada persona de su equipo | No | Sí | No |
| Crear, desactivar y desbloquear cuentas, y asignar roles | No | No | Sí |
| Consultar el registro de auditoría | No | No | Sí |
| Ver conversaciones, memoria, adjuntos o tokens de otra persona | No | No | No |
| Aprobar o aplicar registros en nombre de otra persona | No | No | No |

El líder ve el estado del registro (días pendientes, PAT por vencer), no el contenido de las conversaciones. El
administrador opera la plataforma, pero los secretos y el contenido de cada persona están cifrados con claves por
persona y tampoco puede leerlos.

## Política de aprobación de escrituras

Aplica a toda escritura en Azure DevOps, Ripor y Google Chat:

1. **Vista previa.** Linky arma la propuesta completa (campos, horas, evidencias) y calcula una huella de su contenido.
2. **Revisión.** La persona ve exactamente lo que se va a escribir.
3. **Aprobación.** Solo la persona dueña del registro aprueba, con un botón en la web o con su "sí" en el chat.
4. **Aplicación.** Se escribe solo si la huella aprobada coincide con la vista previa vigente; si algo cambió, se
   rechaza y se vuelve a proponer.
5. **Conciliación.** Si el resultado de una escritura queda incierto, se revisa el destino antes de repetirla. Nunca se
   reintenta a ciegas.
6. **Auditoría.** Cada escritura aprobada queda registrada con la persona, la acción, el destino y el resultado, sin
   secretos.

## Sesiones y cuentas

- Contraseña guardada con un hash resistente a fuerza bruta; nunca en texto plano.
- Bloqueo temporal tras varios intentos fallidos y cierre de sesión por inactividad.
- Las cuentas se crean y desactivan por el administrador; una cuenta desactivada no puede iniciar sesión ni conserva
  sesiones abiertas.
