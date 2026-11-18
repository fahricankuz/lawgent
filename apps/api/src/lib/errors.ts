export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Kayıt') => new HttpError(404, `${what} bulunamadı`, 'not_found');
export const forbidden = (msg = 'Bu işlem için yetkiniz yok') => new HttpError(403, msg, 'forbidden');
export const badRequest = (msg: string) => new HttpError(400, msg, 'bad_request');
