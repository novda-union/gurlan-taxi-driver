import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  StatusDriver,
  DriverTypes,
  StatusLicenseDocuments,
  DriverValidation,
} from "@/constants";
import { authInstance } from "@/http";
import { Preferences } from "@capacitor/preferences";
import { useLoading } from "./loading";
import { loadingController, toastController } from "@ionic/vue";
import { useRouter } from "vue-router";
import { DriverResponseStatus } from "@/constants";
import { UniversalResponseStatus } from "@/constants";

interface Driver {
  id?: string;
  oneId?: string;
  fullname: string;
  phone: string[];
  password: string;
  license?: StatusLicenseDocuments;
  registration?: StatusLicenseDocuments;
  rides?: object[];
  status?: StatusDriver;
  type?: DriverTypes;
  approval?: object;
  createdAt?: Date | null;
  lastOnline?: Date | null;
  account?: string;
  deleted?: object;
  rating?: number[];
  car?: object;
  [propName: string]: any; // for files
}

interface Car {
  id?: string;
  oneId?: string;
  name: string;
  color: string;
  number: string;
  driverId?: string;
  driver?: object;
  deleted?: boolean;
}

export const useAuth = defineStore("auth-store", () => {
  const loadingStore = useLoading();
  const router = useRouter();

  const driver = ref<Driver>({
    fullname: "",
    password: "",
    phone: ["+998"],
  });
  const car = ref<Car>({
    name: "",
    color: "",
    number: "",
  });
  const plainPass = ref("");
  const token = ref("");
  const bannedReason = ref("");

  const getDriver = computed(() => {
    return driver.value;
  });

  const getCar = computed(() => {
    return car.value;
  });

  async function setDriver(payload: Driver) {
    driver.value = payload;
  }

  function setDriverSync(payload: Driver) {
    driver.value = payload;
  }

  async function setCar(payload: Car) {
    car.value = payload;
  }

  function setCarSync(payload: Car) {
    car.value = payload;
  }

  async function setToken(payload: string) {
    token.value = payload;
  }

  function setTokenSync(payload: string) {
    token.value = payload;
  }

  async function register(payload: {
    driver: Driver;
    car: Car;
    files: FormData;
  }): Promise<{
    status: UniversalResponseStatus | DriverResponseStatus;
    msg: string;
    [propName: string]: any;
  }> {
    try {
      await loadingStore.setLoading(true);
      plainPass.value = driver.value.password;

      const sendingDriverInfo = await authInstance.post("/register", {
        driver: payload.driver,
        car: payload.car,
      });

      if (sendingDriverInfo.status >= 400) {
        return {
          msg: "Server bilan aloqa mavjud emas, internetingizni tekshirib, dasturga qaytaldan kiring.",
          status: UniversalResponseStatus.ERR_NETWORK,
        };
      }

      if (sendingDriverInfo.data.status === DriverResponseStatus.AUTH_WARNING) {
        return {
          msg: sendingDriverInfo.data.msg,
          status: DriverResponseStatus.AUTH_WARNING,
        };
      }

      if (
        sendingDriverInfo.data.status === DriverResponseStatus.REGISTRATION_DONE
      ) {
        await Promise.allSettled([
          Preferences.set({
            key: "auth_token",
            value: sendingDriverInfo.data.token,
          }),
          Preferences.set({
            key: "driverOneId",
            value: sendingDriverInfo.data.driver.oneId,
          }),
          Preferences.set({
            key: "validation",
            value: "waiting",
          }),
          setDriver(sendingDriverInfo.data.driver as Driver),
          setCar(sendingDriverInfo.data.car as Car),
          setToken(sendingDriverInfo.data.token),
        ]);

        driver.value.password = "";

        return {
          msg: sendingDriverInfo.data.msg,
          status: DriverResponseStatus.REGISTRATION_DONE,
          oneId: sendingDriverInfo.data.driver.oneId,
          password: driver.value.password,
        };
      }

      return {
        status: DriverResponseStatus.UNKNOWN_ERR,
        msg: "Something just happened",
      };
    } catch (error: any) {
      if (
        error.message === "Network Error" ||
        error.message.includes("timeout")
      ) {
        return {
          msg: "Server bilan aloqa mavjud emas, internetingizni tekshirib, dasturga qaytaldan kiring.",
          status: UniversalResponseStatus.ERR_NETWORK,
        };
      }

      // Handle other unknown errors
      return {
        msg: "An unknown error occurred, please try again later.",
        status: DriverResponseStatus.UNKNOWN_ERR,
      };
    } finally {
      await loadingStore.setLoading(false);
    }
  }

  async function checkIfValidated(payload: {
    token: string | null;
    oneId: string | null;
  }) {
    await loadingStore.setLoading(true);

    const loading = await loadingController.create({
      message: "Tekshirilmoqda...",
    });

    await loading.present();
    try {
      const res = await authInstance.get(`/check-validation/${payload.oneId}`, {
        headers: { Authorization: `Bearer ${payload.token}` },
      });
      if (res.status >= 400) {
        await loading.dismiss();
        const toast = await toastController.create({
          message: "Nimadir xato ketdi, internetingizni tekshiring.",
          duration: 4000,
          buttons: [
            {
              text: "OK",
              handler: async () => {
                await toast.dismiss();
              },
            },
          ],
        });

        await toast.present();

        return;
      }

      if (res.data.status === DriverResponseStatus.VALIDATION_WAITING) {
        await loading.dismiss();

        const toast = await toastController.create({
          message: res.data.msg,
          duration: 4000,
          buttons: [
            {
              text: "OK",
              handler: async () => {
                await toast.dismiss();
              },
            },
          ],
        });

        await toast.present();

        await Promise.allSettled([
          Preferences.remove({ key: "banned" }),
          Preferences.set({ key: "validation", value: "waiting" }),
          Preferences.set({ key: "auth_token", value: res.data.token }),
        ]);

        if (router.currentRoute.value.fullPath === "/validation-waiting") {
          return;
        }

        await router.push("/validation-waiting");
        return;
      }

      if (
        res.data.status === DriverResponseStatus.DRIVER_NOT_FOUND ||
        res.data.status === DriverResponseStatus.HEADERS_NOT_FOUND ||
        res.data.status === DriverResponseStatus.DRIVER_TOKEN_NOT_FOUND ||
        res.data.status === DriverResponseStatus.DRIVER_TOKEN_NOT_VALID
      ) {
        await loading.dismiss();

        const toast = await toastController.create({
          message: res.data.msg,
          duration: 4000,
          buttons: [
            {
              text: "OK",
              handler: async () => {
                await toast.dismiss();
              },
            },
          ],
        });

        await Promise.allSettled([
          Preferences.clear(),
          router.push("/register"),
        ]);

        await toast.present();
        return;
      }

      if (res.data.status === DriverResponseStatus.DRIVER_BANNED) {
        await loading.dismiss();

        const toast = await toastController.create({
          message: res.data.msg,
          duration: 4000,
          buttons: [
            {
              text: "OK",
              handler: async () => {
                await toast.dismiss();
              },
            },
          ],
        });

        await toast.present();

        await Promise.allSettled([
          Preferences.remove({ key: "validation" }),
          Preferences.set({ key: "banned", value: "true" }),
        ]);

        if (router.currentRoute.value.fullPath === "/banned") {
          return;
        }

        await router.push("/banned");

        return;
      }

      if (res.data.status === DriverResponseStatus.VALIDATION_FAILED) {
        await loading.dismiss();
        const { value: validation } = await Preferences.get({
          key: "validation",
        });

        if (validation !== DriverValidation.INVALIDATED) {
          const toast = await toastController.create({
            message: res.data.msg,
            duration: 4000,
            buttons: [
              {
                text: "OK",
                async handler() {
                  await toast.dismiss();
                },
              },
            ],
          });

          await toast.present();

          await Preferences.set({
            key: "validation",
            value: DriverValidation.INVALIDATED,
          });
        }

        if (router.currentRoute.value.fullPath !== "/invalidation") {
          await router.push("/invalidation");
          return;
        }

        return;
      }

      if (res.data.status === DriverResponseStatus.VALIDATION_DONE) {
        await loading.dismiss();
        const { value: validation } = await Preferences.get({
          key: "validation",
        });

        if (validation !== "validated") {
          const toast = await toastController.create({
            message: res.data.msg,
            duration: 4000,
            buttons: [
              {
                text: "OK",
                handler: async () => {
                  await toast.dismiss();
                },
              },
            ],
          });

          await toast.present();
        }

        await Promise.allSettled([
          Preferences.remove({ key: "banned" }),
          Preferences.set({ key: "validation", value: "validated" }),
          Preferences.set({ key: "auth_token", value: res.data.token }),
          Preferences.set({ key: "driverOneId", value: res.data.driver.oneId }),
        ]);
        setTimeout(() => {
          router.push("/home");
        }, 500);
        return;
      }

      if (res.data.status === DriverResponseStatus.LOGIN_FAILED) {
        const toast = await toastController.create({
          message: res.data.msg,
          duration: 4000,
          buttons: [
            {
              text: "OK",
              async handler() {
                await toast.dismiss();
              },
            },
          ],
        });

        await toast.present();
        return;
      }

      if (res.data.status === DriverResponseStatus.LOGIN_DONE) {
        await Promise.allSettled([
          Preferences.set({
            key: "validation",
            value: DriverValidation.SUCCESS,
          }),
          Preferences.set({ key: "driverOneId", value: res.data.driver.oneId }),
          Preferences.set({ key: "auth_token", value: res.data.token }),
        ]);

        return;
      }
    } catch (error: any) {
      await loading.dismiss();

      console.log(error);

      if (
        error.message === "Network Error" ||
        error.message.includes("timeout")
      ) {
        const newToast = await toastController.create({
          message: "Serverda xatolik, yoki internet bilan aloqa mavjud emas.",
          duration: 4000,
          buttons: [
            {
              text: "OK",
              async handler() {
                await newToast.dismiss();
              },
            },
          ],
        });

        await newToast.present();

        return;
      }

      // Handle other unknown errors
      const newToast = await toastController.create({
        message: "Noma'lum xatolik sodir bo'ldi, boshqatdan urinib ko'ring",
        duration: 4000,
        buttons: [
          {
            text: "OK",
            async handler() {
              await newToast.dismiss();
            },
          },
        ],
      });

      await newToast.present();

      return;
    } finally {
      await loadingStore.setLoading(false);
    }
  }

  async function checkIfLoggedIn(payload: {
    oneId: string;
    token: string;
  }): Promise<void> {
    try {
      const res = await authInstance.get(`/check-logged-in/${payload.oneId}`, {
        headers: { Authorization: `Bearer ${payload.token}` },
      });

      const toastModal = await toastController.create({
        duration: 4000,
        buttons: [
          {
            text: "OK",
            async handler() {
              await toastModal.dismiss();
            },
          },
        ],
      });

      if (res.status >= 400) {
        alert(res.status)
        toastModal.message = `Server bilan aloqa mavjud emas, internetingizni tekshirib boshqatdan urinib ko'ring`;
        await toastModal.present();
        return;
      }

      if (
        res.data.status === DriverResponseStatus.DRIVER_NOT_FOUND ||
        res.data.status === DriverResponseStatus.HEADERS_NOT_FOUND ||
        res.data.status === DriverResponseStatus.DRIVER_TOKEN_NOT_FOUND ||
        res.data.status === DriverResponseStatus.DRIVER_TOKEN_NOT_VALID
      ) {
        toastModal.message =
          "Ma'lumotlaringiz topilmadi, yoki yaroqsiz. Boshqatdan ro'yxatdan o'ting";
        await toastModal.present();
        await Preferences.clear();

        setTimeout(() => {
          router.push("/register");
        }, 300);
        return;
      }

      if (res.data.status === DriverResponseStatus.DRIVER_BANNED) {
        toastModal.message = "Sizning akkauntingiz bloklandi.";
        await toastModal.present();
        await Promise.allSettled([
          Preferences.set({ key: "banned", value: "true" }),
          Preferences.remove({ key: "validation" }),
        ]);

        setTimeout(() => {
          router.push("/banned");
        }, 300);
        return;
      }

      if (res.data.status === DriverResponseStatus.LOGIN_FAILED) {
        toastModal.message = "Tizimdan foydalanishga sizda imkoniyat yo'q";
        await toastModal.present();

        await Promise.allSettled([
          Preferences.set({
            key: "validation",
            value: DriverValidation.INVALIDATED,
          }),
          Preferences.remove({ key: "banned" }),
        ]);
        return;
      }

      if (res.data.status === DriverResponseStatus.LOGIN_DONE) {
        await Promise.allSettled([
          Preferences.set({
            key: "validation",
            value: DriverValidation.SUCCESS,
          }),
          Preferences.set({ key: "driverOneId", value: res.data.driver.oneId }),
          Preferences.set({ key: "auth_token", value: res.data.token }),
        ]);
        return;
      }

      return;
    } catch (error: any) {
      console.log(error);

      if (
        error.message === "Network Error" ||
        error.message.includes("timeout")
      ) {
        const newToast = await toastController.create({
          message: "Serverda xatolik, yoki internet bilan aloqa mavjud emas.",
          duration: 4000,
          buttons: [
            {
              text: "OK",
              async handler() {
                await newToast.dismiss();
              },
            },
          ],
        });

        await newToast.present();

        return;
      }

      const newToast = await toastController.create({
        message: "Noma'lum xatolik yuz berdi, birozdan keyin urinib ko'ring",
        duration: 4000,
        buttons: [
          {
            text: "OK",
            async handler() {
              await newToast.dismiss();
            },
          },
        ],
      });

      await newToast.present();
    }
  }

  async function login(payload: { oneId: string; password: string }): Promise<{
    msg: string;
    status: UniversalResponseStatus | DriverResponseStatus;
    [propName: string]: any;
  }> {
    try {
      await loadingStore.setLoading(true);
      const { value: token } = await Preferences.get({ key: "auth_token" });

      const res = await authInstance.post("/login", payload, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status >= 400) {
        return {
          msg: "Server bilan aloqa mavjud emas, internetingizni tekshirib, dasturga qaytaldan kiring.",
          status: UniversalResponseStatus.ERR_NETWORK,
        };
      }

      return {
        msg: res.data.msg,
        status: res.data.status,
        reason: res.data?.reason || null,
        token: res.data?.token || null,
        oneId: res.data?.driver?.oneId || null,
      };
    } catch (error: any) {
      if (
        error.message === "Network Error" ||
        error.message.includes("timeout")
      ) {
        return {
          msg: "Server bilan aloqa mavjud emas, internetingizni tekshirib, dasturga qaytaldan kiring.",
          status: UniversalResponseStatus.ERR_NETWORK,
        };
      }

      return {
        msg: "An unknown error occurred, please try again later.",
        status: DriverResponseStatus.UNKNOWN_ERR,
      };
    } finally {
      await loadingStore.setLoading(false);
    }
  }

  return {
    register,
    driver,
    car,
    getDriver,
    getCar,
    plainPass,
    token,
    checkIfValidated,
    bannedReason,
    login,
    checkIfLoggedIn,
  };
});
