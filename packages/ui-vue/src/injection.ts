import type { InjectionKey } from 'vue';
import type { GISApp } from '@joinmap/gis-core';

export const GISAppKey: InjectionKey<GISApp> = Symbol('joinmap.gis-app');
