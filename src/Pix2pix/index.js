// Copyright (c) 2018 ml5
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

/* eslint max-len: "off" */
/*
Pix2pix
The original pix2pix TensorFlow implementation was made by affinelayer: github.com/affinelayer/pix2pix-tensorflow
This version is heavily based on Christopher Hesse TensorFlow.js implementation: https://github.com/affinelayer/pix2pix-tensorflow/tree/master/server
*/

import * as tf from '@tensorflow/tfjs';
import CheckpointLoaderPix2pix from '../utils/checkpointLoaderPix2pix';
import { array3DToImage } from '../utils/imageUtilities';
import callCallback from '../utils/callcallback';

class Pix2pix {
  constructor(model, callback) {
    this.ready = callCallback(this.loadCheckpoints(model), callback);
  }

  async loadCheckpoints(path) {
    const checkpointLoader = new CheckpointLoaderPix2pix(path);
    this.variables = await checkpointLoader.getAllVariables();
    return this;
  }

  async transfer(inputElement, cb) {
    return callCallback(this.transferInternal(inputElement), cb);
  }

  async transferInternal(inputElement) {
    const input = tf.fromPixels(inputElement);
    const inputData = input.dataSync();
    const floatInput = tf.tensor3d(inputData, input.shape);
    const normalizedInput = tf.div(floatInput, tf.scalar(255));

    const result = array3DToImage(tf.tidy(() => {
      const preprocessedInput = Pix2pix.preprocess(normalizedInput);
      const layers = [];
      let filter = this.variables['generator/encoder_1/conv2d/kernel'];
      let bias = this.variables['generator/encoder_1/conv2d/bias'];
      let convolved = Pix2pix.conv2d(preprocessedInput, filter, bias);
      layers.push(convolved);

      for (let i = 2; i <= 8; i += 1) {
        const scope = `generator/encoder_${i.toString()}`;
        filter = this.variables[`${scope}/conv2d/kernel`];
        const bias2 = this.variables[`${scope}/conv2d/bias`];
        const layerInput = layers[layers.length - 1];
        const rectified = tf.leakyRelu(layerInput, 0.2);
        convolved = Pix2pix.conv2d(rectified, filter, bias2);
        const scale = this.variables[`${scope}/batch_normalization/gamma`];
        const offset = this.variables[`${scope}/batch_normalization/beta`];
        const normalized = Pix2pix.batchnorm(convolved, scale, offset);
        layers.push(normalized);
      }

      for (let i = 8; i >= 2; i -= 1) {
        let layerInput;
        if (i === 8) {
          layerInput = layers[layers.length - 1];
        } else {
          const skipLayer = i - 1;
          layerInput = tf.concat([layers[layers.length - 1], layers[skipLayer]], 2);
        }
        const rectified = tf.relu(layerInput);
        const scope = `generator/decoder_${i.toString()}`;
        filter = this.variables[`${scope}/conv2d_transpose/kernel`];
        bias = this.variables[`${scope}/conv2d_transpose/bias`];
        convolved = Pix2pix.deconv2d(rectified, filter, bias);
        const scale = this.variables[`${scope}/batch_normalization/gamma`];
        const offset = this.variables[`${scope}/batch_normalization/beta`];
        const normalized = Pix2pix.batchnorm(convolved, scale, offset);
        layers.push(normalized);
      }

      const layerInput = tf.concat([layers[layers.length - 1], layers[0]], 2);
      let rectified2 = tf.relu(layerInput);
      filter = this.variables['generator/decoder_1/conv2d_transpose/kernel'];
      const bias3 = this.variables['generator/decoder_1/conv2d_transpose/bias'];
      convolved = Pix2pix.deconv2d(rectified2, filter, bias3);
      rectified2 = tf.tanh(convolved);
      layers.push(rectified2);

      const output = layers[layers.length - 1];
      const deprocessedOutput = Pix2pix.deprocess(output);
      return deprocessedOutput;
    }));

    await tf.nextFrame();
    return result;
  }

  static preprocess(inputPreproc) {
    return tf.sub(tf.mul(inputPreproc, tf.scalar(2)), tf.scalar(1));
  }

  static deprocess(inputDeproc) {
    return tf.div(tf.add(inputDeproc, tf.scalar(1)), tf.scalar(2));
  }

  static batchnorm(inputBat, scale, offset) {
    const moments = tf.moments(inputBat, [0, 1]);
    const varianceEpsilon = 1e-5;
    return tf.batchNormalization(inputBat, moments.mean, moments.variance, varianceEpsilon, scale, offset);
  }

  static conv2d(inputCon, filterCon) {
    return tf.conv2d(inputCon, filterCon, [2, 2], 'same');
  }

  static deconv2d(inputDeconv, filterDeconv, biasDecon) {
    const convolved = tf.conv2dTranspose(inputDeconv, filterDeconv, [inputDeconv.shape[0] * 2, inputDeconv.shape[1] * 2, filterDeconv.shape[2]], [2, 2], 'same');
    const biased = tf.add(convolved, biasDecon);
    return biased;
  }
}

const pix2pix = (model, callback) => {
  const instance = new Pix2pix(model, callback);
  return callback ? instance : instance.ready;
};

export default pix2pix;
