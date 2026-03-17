// API types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiSuccess<T = unknown> {
  status: 'success';
  data: T;
}

export interface ApiFailure<E extends ApiError = ApiError> {
  status: 'error';
  error: E;
}

export type ApiResult<T = unknown, E extends ApiError = ApiError> =
  | ApiSuccess<T>
  | ApiFailure<E>;
