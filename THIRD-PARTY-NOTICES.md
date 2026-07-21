# Third-Party Notices

Safe Online Exam includes and depends on third-party software. Those
components remain under their own license terms; this repository's
[PolyForm Noncommercial License](LICENSE) applies only to the project's
own copyrightable material.

The exact dependency graph is locked in `package-lock.json`. The
production container retains the upstream package materials, including
license files, in `/app/node_modules`.

## Direct Runtime Dependencies

| Component                                                             | License    |
| --------------------------------------------------------------------- | ---------- |
| NestJS (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`) | MIT        |
| `clsx`                                                                | MIT        |
| `cookie-parser`                                                       | MIT        |
| `express`, `express-session`                                          | MIT        |
| `jose`                                                                | MIT        |
| `lucide-react`                                                        | ISC        |
| `pg`                                                                  | MIT        |
| `plist`                                                               | MIT        |
| `react`, `react-dom`                                                  | MIT        |
| `reflect-metadata`                                                    | Apache-2.0 |

Run `npm ci` to retrieve the locked packages and their full upstream
license and notice files. Anyone redistributing a built image or package
must continue to comply with the notices and license terms that accompany
those dependencies.
