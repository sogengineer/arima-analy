declare module 'regression' {
  export interface DataPoint {
    [0]: number;
    [1]: number;
  }

  export interface RegressionResult {
    equation: number[];
    points: number[][];
    string: string;
    r2: number;
    predict: (x: number) => number[];
  }

  export function linear(data: DataPoint[]): RegressionResult;
  export function exponential(data: DataPoint[]): RegressionResult;
  export function logarithmic(data: DataPoint[]): RegressionResult;
  export function power(data: DataPoint[]): RegressionResult;
  export function polynomial(data: DataPoint[], options?: { order: number }): RegressionResult;
}
