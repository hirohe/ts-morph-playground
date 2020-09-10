import axios, { AxiosError, AxiosResponse } from 'axios';

// cancel token for canceling request
// const CancelTokenSource = axios.CancelToken.source();

// axios configuration
const request = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

/**
 * Problem Details Json Response
 * RFC-7807 https://tools.ietf.org/html/rfc7807
 */
export interface ServiceProblem {
  title: string;
  status: number;
  detail?: string;
}

/**
 * 接口请求错误类，包含problem和response属性
 * 用于辨识错误类型 e.g. if (error instanceof ServiceError)
 */
export class ServiceError extends Error {
  problem: ServiceProblem;
  response: AxiosResponse;

  /**
   * ServiceError构造函数
   * @param problem: 从AxiosResponse的data转换的ServiceProblem
   * @param response: 对应axios请求的AxiosResponse
   */
  constructor(problem: ServiceProblem, response: AxiosResponse) {
    super(problem.title);
    this.problem = problem;
    this.response = response;
  }
}

request.interceptors.response.use(response => response, error => {
  if (error.isAxiosError) {
    const response = (error as AxiosError).response;

    // check if status 401
    if (response && response.status === 401) {
      // TODO
    } else if (response && response.data !== undefined && response.data !== null) {
      const problem = response.data as ServiceProblem;
      throw new ServiceError(problem, response);
    }
  }

  throw error;
});

export default request;
