import { NextFunction, Request, Response, Router } from "express";
import {
  RequestActions,
  ResponseActions
} from "../schemas/configs/actions.app.config.schema";
import { AppMode } from "../schemas/configs/app.config.schema";
import { GatewayMode } from "../schemas/configs/gateway.app.config.schema";
import { getConfig } from "../utils/config.utils";
import logger from "../utils/logger.utils";
import { jsonCompressorMiddleware } from "../middlewares/jsonParser.middleware";
import {
  authBuilderMiddleware,
  authValidatorMiddleware
} from "../middlewares/auth.middleware";
import { contextBuilderMiddleware } from "../middlewares/context.middleware";
import { openApiValidatorMiddleware } from "../middlewares/schemaValidator.middleware";
import { bapClientTriggerHandler } from "../controllers/bap.trigger.controller";
import { bppNetworkRequestHandler } from "../controllers/bpp.request.controller";
import { Locals } from "../interfaces/locals.interface";
import { unConfigureActionHandler } from "../controllers/unconfigured.controller";
import * as OpenApiValidator from "express-openapi-validator";
import fs from "fs";
import path from "path";
import { LogLevelEnum } from "../utils/logger.utils";
import { onAPI } from "../utils/telemetry.utils";
import { start } from "repl";

export const requestsRouter = Router();

export async function executionTime(req: Request, res: Response<{}, Locals>, next: NextFunction, action: string, startTime: number, middlewareFn: Function) {
  await middlewareFn
  console.log(`### Time to process:`, Date.now() - startTime);
}

requestsRouter.get("/logs", (req, res) => {
  try {
    const logLevel: LogLevelEnum = req?.query?.type as LogLevelEnum;
    const files = fs.readdirSync(
      path.join(__dirname + `../../../logs/${logLevel}`)
    );
    return res.sendFile(
      path.join(
        __dirname + `../../../logs/${logLevel}/${files[files.length - 1]}`
      ),
      (err) => {
        if (err) {
          res.json({ success: false, message: err.message });
        }
      }
    );
  } catch (error: any) {
    logger.error(error.message);
    throw new Error("Some Error Occured");
  }
});

// BAP Client-Side Gateway Configuration.
if (
  getConfig().app.mode === AppMode.bap &&
  getConfig().app.gateway.mode === GatewayMode.client
) {
  const requestActions = getConfig().app.actions.requests;
  Object.keys(RequestActions).forEach((action) => {
    if (requestActions[action as RequestActions]) {
      // requestsRouter.post(`/${action}`, jsonCompressorMiddleware, contextBuilderMiddleware, authBuilderMiddleware, openApiValidatorMiddleware, bapClientTriggerHandler);
      let startTime = Date.now();
      let prevMWTime = Date.now();
      let currentTime = Date.now();
      requestsRouter.post(
        `/${action}`,
        async(req: Request, res: Response<{}, Locals>, next: NextFunction) => {
          startTime = currentTime = Date.now();
          prevMWTime = currentTime;
          await jsonCompressorMiddleware(req, res, next);
        },
        async (req: Request, res: Response<{}, Locals>, next: NextFunction) => {
          currentTime = Date.now();
          console.log(`### jsonCompressorMiddleware Processing Time:`, currentTime - prevMWTime, `ms`);
          prevMWTime = currentTime;
          await contextBuilderMiddleware(req, res, next, action);
        },
        async (req: Request, res: Response<{}, Locals>, next: NextFunction) => {
          currentTime = Date.now();
          console.log(`### contextBuilderMiddleware Processing Time:`, currentTime - prevMWTime, `ms`);
          prevMWTime = currentTime;
          await authBuilderMiddleware(req, res, next);
        },
        async (req: Request, res: Response<{}, Locals>, next: NextFunction) => {
          currentTime = Date.now();
          console.log(`### authBuilderMiddleware Processing Time:`, currentTime - prevMWTime, `ms`);
          prevMWTime = currentTime;
          // await openApiValidatorMiddleware(req, res, next);
          next();
        },
        async (req: Request, res: Response<{}, Locals>, next: NextFunction) => {
          currentTime = Date.now();
          console.log(`### openApiValidatorMiddleware Processing Time:`, currentTime - prevMWTime, `ms`);
          await bapClientTriggerHandler(
            req,
            res,
            next,
            action as RequestActions,
            startTime
          );
        }
      );
    } else {
      requestsRouter.post(
        `/${action}`,
        async (req: Request, res: Response, next: NextFunction) => {
          await unConfigureActionHandler(req, res, next, action);
        }
      );
    }
  });
}

// BPP Network-Side Gateway Configuration.
if (
  getConfig().app.mode == AppMode.bpp &&
  getConfig().app.gateway.mode === GatewayMode.network
) {
  const requestActions = getConfig().app.actions.requests;
  Object.keys(RequestActions).forEach((action) => {
    if (requestActions[action as RequestActions]) {
      requestsRouter.post(
        `/${action}`,
        async(req: Request, res: Response<{}, Locals>, next: NextFunction) => {
          console.log(`Start time: ${new Date().toISOString()}`)
          next();
        },
        jsonCompressorMiddleware,
        authValidatorMiddleware,
        //openApiValidatorMiddleware,
        async (req: Request, res: Response<{}, Locals>, next: NextFunction) => {
          await bppNetworkRequestHandler(
            req,
            res,
            next,
            action as RequestActions
          );
        },
        onAPI
      );
    } else {
      requestsRouter.post(
        `/${action}`,
        async (req: Request, res: Response, next: NextFunction) => {
          await unConfigureActionHandler(req, res, next, action);
        }
      );
    }
  });
}
