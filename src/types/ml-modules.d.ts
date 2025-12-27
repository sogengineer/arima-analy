declare module 'ml-logistic-regression' {
  interface LogisticRegressionOptions {
    numSteps?: number;
    learningRate?: number;
  }

  export default class LogisticRegression {
    constructor(options?: LogisticRegressionOptions);
    train(features: number[][], labels: number[]): void;
    predict(features: number[][]): number[];
  }
}

declare module 'simple-statistics' {
  export function mean(data: number[]): number;
  export function sampleCorrelation(x: number[], y: number[]): number;
}
