/**
 * This file was auto-generated.
 * Do not make direct changes to the file.
 */
// @ts-ignore
import { autoinject } from 'aurelia-framework';
// @ts-ignore
import { DataContext } from 'resources/utils/data-context';

/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/camelcase */
export namespace $123Api {
  @autoinject()
  export class SwaggerTest {
    constructor(private dc: DataContext) {}
    // POST /SwaggerTest/UploadSample
    public uploadSample(formModel: {
      file?: Blob;
      files?: Blob[];
      model?: $123Models.UploadModel;
      modelList?: $123Models.UploadModel[];
    }): Promise<boolean> {
      const formData = new FormData();
      Object.entries(formModel).forEach(([key, value]) => {
        if (value instanceof Blob) {
          formData.append(key, value);
        } else if (
          Array.isArray(value) &&
          value.length &&
          value[0] instanceof Blob
        ) {
          for (let blob of value as Blob[]) {
            formData.append(key, blob);
          }
        } else {
          formData.append(key, JSON.stringify(value));
        }
      });
      return this.dc.post('swaggerTest/uploadSample', formData);
    }
  }
}

export namespace $123Models {
  export interface UploadModel {
    mid?: string;
  }
}

export namespace $123Types {}
