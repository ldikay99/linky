---
name: linky-dev
description: Evidencia de desarrollo (opcional) — commits locales del día con enlace a Azure Repos o GitHub, Tasks mencionadas (AB#123) y PRs de Azure creados o cerrados. Solo para quien desarrolla.
---

# Linky — Desarrollo (opcional)

**Autor:** Jonathan Contreras

No todas las personas hacen commits. En el onboarding, preguntar si desarrolla; si no, omitir esta skill.

## Activar (una vez)

```bash
npm run linky -- dev scan --root "<carpeta con sus repos>" [--email <correo de git>]
npm run linky -- dev repos                       # mostrar la lista a la persona
npm run linky -- dev remove --repo "<nombre>"    # quitar repos personales o que no son de trabajo
```

## Uso

```bash
npm run linky -- dev day --date YYYY-MM-DD
```

- Commits del día (sin duplicados entre copias del mismo repo) con enlace web y Tasks mencionadas (`AB#123`).
- PRs de Azure creados o cerrados ese día por la persona.
- `ripor suggest` los ofrece como **evidencia alternativa** (un PR es evidencia más concreta que la HU).
- `azure hours` usa los commits que mencionan una Task como señal de trabajo en ella.
- Los mensajes de commit pueden traer fechas: en descripciones de Ripor/Azure no se copian fechas.
- Los remotos con credenciales incrustadas se sanean: nunca se muestra ni se usa el token.
