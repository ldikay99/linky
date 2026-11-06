---
name: linky-mail
description: Leer los correos del día en Gmail (por defecto los enviados por la persona) como evidencia de lo hecho. Solo lectura, headless con la sesión de Google de Linky, sin API keys.
---

# Linky — Gmail (agnóstico de proveedor)

**Autor:** Jonathan Contreras

```bash
npm run linky -- mail day --date YYYY-MM-DD              # enviados por la persona (lo que hizo)
npm run linky -- mail day --date YYYY-MM-DD --received   # recibidos (bandeja de entrada)
npm run linky -- mail day --date YYYY-MM-DD --all
npm run linky -- day --mail                              # incluido en el resumen del día
```

Devuelve por correo: hora, asunto, personas, fragmento y enlace al hilo. Usa la sesión de Google del perfil de Linky
(`google login`). El día se calcula en la zona horaria del equipo.

## Uso

- Evidencia: un correo enviado puede respaldar una tarea (entregas, coordinación con cliente). Su enlace sirve como
  evidencia de Azure o Ripor si la persona lo prefiere a la HU.
- Los recibidos son contexto, no trabajo hecho: no reportar como actividad propia sin confirmación.
- No copiar contenido de correos de terceros a Azure/Ripor/chat sin permiso de la persona.
- Solo lectura: Linky no envía ni modifica correos.
