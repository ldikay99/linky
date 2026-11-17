# Alcance y criterios de aceptación

Linky registra el día de trabajo de cada persona del área de Datos en Azure DevOps y Ripor, con las reuniones y los
correos del día como evidencia. Este documento fija qué entra en la versión para el área, en qué orden y cómo se
acepta cada parte.

## Objetivo

Que cada persona del área registre su jornada desde un chat, en pocos minutos, sin copiar datos entre herramientas y
sin escribir nada que no haya aprobado.

## Dentro del alcance

Por orden de prioridad:

1. **Azure DevOps.** Leer la actividad del día, proponer Tasks bajo las HU de la persona con título, descripción,
   actividad, horas y evidencias, y aplicar los cambios de estado y horas. Toda escritura pasa por una vista previa que
   la persona aprueba.
2. **Evidencias de Google Calendar y Gmail.** Reuniones confirmadas por la persona y correos enviados del día, como
   soporte de cada registro.
3. **Dictado por voz.** Transcripción rápida en el cuadro de mensaje. El asistente responde por escrito; no habla.
4. **Memoria por persona.** El asistente recuerda las preferencias y el contexto de cada persona entre conversaciones.
5. **Ripor.** Registro diario con horas, descripción y evidencia, con vista previa y aprobación. Es el último frente
   del sprint.

Base que lo soporta:

- Base de datos PostgreSQL local con migraciones versionadas.
- Inicio de sesión por persona y control de acceso por rol (ver [ROLES-Y-PERMISOS.md](ROLES-Y-PERMISOS.md)).
- Secretos y tokens cifrados por persona, con registro de auditoría.
- Almacenamiento cifrado de adjuntos y evidencias, con cuota por persona.
- Un servidor compartido del área de Datos, con HTTPS y acceso solo desde la red interna.

## Fuera del alcance

- Infraestructura en la nube y repositorio de la empresa: se solicitan después de presentar los resultados.
- Respuestas por voz del asistente.
- Registro en nombre de otra persona.
- Áreas distintas a Datos.

## Reglas que no cambian

- Nada se escribe en Azure DevOps ni en Ripor sin la aprobación explícita de la persona sobre la vista previa.
- No se inventan horas, tareas, reuniones ni evidencias. Si falta información, se pregunta.
- Las descripciones no llevan fechas; la fecha va en su campo.
- Jornada de lunes a jueves de 8,5 h y viernes de 8 h. Festivos de Colombia, sábados y domingos no se exigen.
- Los tokens y las sesiones nunca se guardan en texto plano ni salen del equipo de la persona o del servidor del área.

## Criterios de aceptación

| ID | Frente | Criterio |
|---|---|---|
| CA-1 | Azure DevOps | Desde el chat, la persona obtiene la propuesta de Tasks de su día bajo sus HU, la revisa y, al aprobarla, queda creada con todos los campos que exige su equipo. |
| CA-2 | Azure DevOps | Si la vista previa cambió entre la propuesta y la aprobación, la escritura se rechaza y se vuelve a proponer. |
| CA-3 | Evidencias | Las reuniones confirmadas y los correos enviados del día aparecen como evidencia del registro; los eventos generales no cuentan. |
| CA-4 | Dictado | El texto dictado aparece en el cuadro de mensaje mientras la persona habla y se puede editar antes de enviarlo. |
| CA-5 | Memoria | En una conversación nueva, el asistente conserva las preferencias de la persona sin que tenga que repetirlas. |
| CA-6 | Ripor | El día se registra en Ripor con horas, descripción y evidencia tras la aprobación, y un registro incierto se concilia antes de repetirse. |
| CA-7 | Acceso | Cada persona entra con su usuario y solo ve sus conversaciones, conexiones y registros. |
| CA-8 | Seguridad | Tokens, sesiones y adjuntos quedan cifrados por persona; ningún secreto aparece en registros ni en respuestas. |
| CA-9 | Operación | El área de Datos usa Linky en el servidor compartido, con respaldos automáticos de la base de datos y los adjuntos. |
