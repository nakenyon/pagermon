angular.module('app', ['ngRoute', 'ngResource', 'ngSanitize', 'angular-uuid', 'ui.bootstrap', 'ui.validate', 'textAngular'])
    // Service
    .factory('Api', ['$resource',
        function ($resource) {
            return {
                Login: $resource('/auth/login/', null, {
                    'post': { method: 'POST', isArray: false }
                }),
                Register: $resource('/auth/register/', null, {
                    'post': { method: 'POST', isArray: false }
                }),
                Reset: $resource('/auth/reset/', null, {
                    'post': { method: 'POST', isArray: false }
                }),
                Forgot: $resource('/auth/forgot/', null, {
                    'post': { method: 'POST', isArray: false }
                }),
                ResetPassword: $resource('/auth/reset-password/', null, {
                    'post': { method: 'POST', isArray: false }
                }),
                VerifyEmail: $resource('/auth/verify-email/', null, {
                    'post': { method: 'POST', isArray: false }
                }),
                UserDetail: $resource('/api/user/:id', { id: '@id' }, {
                    'post': { method: 'POST', isArray: false }
                }),
                UsernameCheck: $resource('/auth/userCheck/username/:id', { id: '@id' }, {
                    'post': { method: 'POST', isArray: false }
                }),
                UseremailCheck: $resource('/auth/userCheck/email/:id', { id: '@id' }, {
                    'post': { method: 'POST', isArray: false }
                }),
                Profile: $resource('/auth/profile/me', null, {
                    'post': { method: 'POST', isArray: false }
                })
            };
        }])

    .controller('LoginController', ['$scope', '$routeParams', 'Api', '$uibModal', '$filter', '$location', '$timeout', '$window', function ($scope, $routeParams, Api, $uibModal, $filter, $location, $timeout, $window) {
        $scope.loading = false;
        $scope.loginMessage = {};

        $scope.loginSubmit = function () {
            $scope.loading = true;
            Api.Login.post(null, $scope.user).$promise.then(function (response) {
                console.log(response);
                $scope.loading = false;
                if (response.status == 'ok') {
                    $window.location.href = response.redirect
                } else {
                    $scope.loginMessage.text = 'Login Error: ' + response.data.error;
                    $scope.loginMessage.type = 'alert-danger';
                    $scope.loginMessage.show = true;
                    $timeout(function () { $scope.alertMessage.show = false; }, 3000);
                }
            }, function (response) {
                console.log(response);
                $scope.loginMessage.text = 'Login Error: ' + response.data.error;
                $scope.loginMessage.type = 'alert-danger';
                $scope.loginMessage.show = true;
                $timeout(function () { $scope.alertMessage.show = false; }, 3000);
                $scope.loading = false;
            });
        };

    }])

    .controller('RegisterController', ['$scope', '$routeParams', 'Api', '$uibModal', '$filter', '$location', '$timeout', '$window', function ($scope, $routeParams, Api, $uibModal, $filter, $location, $timeout, $window) {
        $scope.userLoading = false;
        $scope.existingUsername = false;
        $scope.existingEmail = false;
        $scope.loading = false;
        $scope.alertMessage = {};

        $scope.checkUsername = function () {
            $scope.userLoading = true;
            if ($scope.user.username) {
                Api.UsernameCheck.get({ id: $scope.user.username }, function (results) {
                    // The endpoint used to echo the matching row back; it now only
                    // answers whether the value is taken, so that it cannot be used
                    // to enumerate accounts.
                    if (results.taken) {
                        $scope.userLoading = false;
                        $scope.existingUsername = true;
                        return true;
                    } else {
                        $scope.userLoading = false;
                        $scope.existingUsername = false;
                        return false;
                    }
                });
            } else {
                $scope.userLoading = false;
                $scope.existingUsername = false;
                return false;
            }
        };

        $scope.checkEmail = function () {
            $scope.userLoading = true;
            if ($scope.user.email) {
                Api.UseremailCheck.get({ id: $scope.user.email }, function (results) {
                    if (results.taken) {
                        $scope.userLoading = false;
                        $scope.existingEmail = true;
                        return true;
                    } else {
                        $scope.userLoading = false;
                        $scope.existingEmail = false;
                        return false;
                    }
                });
            } else {
                $scope.userLoading = false;
                $scope.existingEmail = false;
                return false;
            }
        };

        $scope.registerSubmit = function () {
            console.log('fire')
            if ($scope.existingUsername) {
                $scope.alertMessage.text = 'Error creating user: User with this username already exists.';
                $scope.alertMessage.type = 'alert-danger';
                $scope.alertMessage.show = true;
                $timeout(function () { $scope.alertMessage.show = false; }, 3000);
            } else if ($scope.existingEmail) {
                $scope.alertMessage.text = 'Error creating user: User with this email already exists.';
                $scope.alertMessage.type = 'alert-danger';
                $scope.alertMessage.show = true;
                $timeout(function () { $scope.alertMessage.show = false; }, 3000);
            } else {
                $scope.userLoading = true;
                Api.Register.save(null, $scope.user).$promise.then(function (response) {
                    console.log(response);
                    if (response.status == 'ok') {
                        $scope.alertMessage.text = 'User created!';
                        $scope.alertMessage.type = 'alert-success';
                        $scope.alertMessage.show = true;
                        $timeout(function () { $scope.alertMessage.show = false; }, 3000);
                        $scope.userLoading = false;
                        $window.location.href = response.redirect
                    } else {
                        $scope.alertMessage.text = 'Error creating user: ' + response;
                        $scope.alertMessage.type = 'alert-danger';
                        $scope.alertMessage.show = true;
                        $timeout(function () { $scope.alertMessage.show = false; }, 3000);
                        $scope.userLoading = false;
                    }
                }, function (response) {
                    console.log(response);
                    $scope.alertMessage.text = 'Error creating user: ' + response.data.error;
                    $scope.alertMessage.type = 'alert-danger';
                    $scope.alertMessage.show = true;
                    $timeout(function () { $scope.alertMessage.show = false; }, 3000);
                    $scope.userLoading = false;
                });
            }
        };
    }])

    .controller('ResetController', ['$scope', '$routeParams', 'Api', '$uibModal', '$filter', '$location', '$timeout', '$window', function ($scope, $routeParams, Api, $uibModal, $filter, $location, $timeout, $window) {
        $scope.resetMessage = {};
        $scope.resetSubmit = function () {
            // Belt and braces: the form's ui-validate already blocks submit on a
            // mismatch, but the controller must not depend on that being present.
            if ($scope.password !== $scope.confirm_password) {
                $scope.resetMessage.text = 'The new passwords do not match';
                $scope.resetMessage.type = 'alert-danger';
                $scope.resetMessage.show = true;
                return;
            }
            $scope.loading = true;
            // currentpassword is required by the server - proving you know the
            // existing password is what stops a stolen session taking the account.
            var vars = {
                'user': $scope.user,
                'currentpassword': $scope.currentpassword,
                'password': $scope.password
            };

            Api.Reset.post(null, vars).$promise.then(function (response) {
                $scope.loading = false;
                if (response.status == 'ok') {
                    $window.location.href = response.redirect
                } else {
                    $scope.resetMessage.text = 'Failed to reset password: ' + response.data.error;
                    $scope.resetMessage.type = 'alert-danger';
                    $scope.resetMessage.show = true;
                    $timeout(function () { $scope.resetMessage.show = false; }, 5000);
                }
            }, function (response) {
                $scope.resetMessage.text = 'Failed to reset password: ' + ((response.data && response.data.error) || 'unknown error');
                $scope.resetMessage.type = 'alert-danger';
                $scope.resetMessage.show = true;
                $timeout(function () { $scope.resetMessage.show = false; }, 5000);
                $scope.loading = false;
            });
        };
    }])

    .controller('ForgotController', ['$scope', 'Api', '$timeout', function ($scope, Api, $timeout) {
        $scope.forgotMessage = {};
        $scope.loading = false;
        $scope.sent = false;

        $scope.forgotSubmit = function () {
            $scope.loading = true;
            Api.Forgot.post(null, { email: $scope.email }).$promise.then(function (response) {
                $scope.loading = false;
                // The server answers identically whether or not the address is
                // registered, so the UI must not imply that it found an account.
                $scope.sent = true;
                $scope.forgotMessage.text = response.message;
                $scope.forgotMessage.type = 'alert-success';
                $scope.forgotMessage.show = true;
            }, function (response) {
                $scope.loading = false;
                $scope.forgotMessage.text = (response.data && response.data.error) || 'Something went wrong, please try again later';
                $scope.forgotMessage.type = 'alert-danger';
                $scope.forgotMessage.show = true;
            });
        };
    }])

    .controller('ResetPasswordController', ['$scope', '$routeParams', 'Api', '$timeout', '$window', function ($scope, $routeParams, Api, $timeout, $window) {
        $scope.resetMessage = {};
        $scope.loading = false;
        $scope.done = false;
        $scope.token = $routeParams.token;

        $scope.resetSubmit = function () {
            // Belt and braces: the form's ui-validate already blocks submit on a
            // mismatch, but the controller must not depend on that being present.
            if ($scope.password !== $scope.confirm_password) {
                $scope.resetMessage.text = 'The passwords do not match';
                $scope.resetMessage.type = 'alert-danger';
                $scope.resetMessage.show = true;
                return;
            }
            $scope.loading = true;
            Api.ResetPassword.post(null, { token: $scope.token, password: $scope.password }).$promise.then(function (response) {
                $scope.loading = false;
                $scope.done = true;
                $scope.resetMessage.text = 'Password updated. Redirecting you to the login page...';
                $scope.resetMessage.type = 'alert-success';
                $scope.resetMessage.show = true;
                // Deliberately not logged in automatically - logging in proves the
                // new password works.
                $timeout(function () { $window.location.href = response.redirect; }, 2000);
            }, function (response) {
                $scope.loading = false;
                $scope.resetMessage.text = (response.data && response.data.error) || 'Something went wrong, please try again';
                $scope.resetMessage.type = 'alert-danger';
                $scope.resetMessage.show = true;
            });
        };
    }])

    .controller('VerifyEmailController', ['$scope', '$routeParams', 'Api', '$timeout', '$window', function ($scope, $routeParams, Api, $timeout, $window) {
        $scope.verifyMessage = {};
        $scope.loading = true;

        // Confirmed on load rather than behind a button: the user already
        // expressed intent by requesting the change and clicking the link.
        Api.VerifyEmail.post(null, { token: $routeParams.token }).$promise.then(function (response) {
            $scope.loading = false;
            $scope.verifyMessage.text = 'Your email address has been confirmed.';
            $scope.verifyMessage.type = 'alert-success';
            $scope.verifyMessage.show = true;
            $timeout(function () { $window.location.href = response.redirect; }, 2000);
        }, function (response) {
            $scope.loading = false;
            $scope.verifyMessage.text = (response.data && response.data.error) || 'That confirmation link is invalid or has expired';
            $scope.verifyMessage.type = 'alert-danger';
            $scope.verifyMessage.show = true;
        });
    }])

    .controller('ProfileController', ['$scope', '$routeParams', 'Api', '$uibModal', '$filter', '$location', '$timeout', function ($scope, $routeParams, Api, $uibModal, $filter, $location, $timeout) {
        $scope.alertMessage = {};
        $scope.loading = true;
        $scope.userSubmit = function () {
            $scope.loading = true;
            Api.Profile.save(null, $scope.user).$promise.then(function (response) {
                if (response.status == 'ok') {
                    if (response.emailPending) {
                        // The address is not committed until the link in the
                        // confirmation email is clicked, so say so rather than
                        // reporting a plain save.
                        $scope.user.pendingEmail = response.pendingEmail;
                        $scope.alertMessage.text = 'Saved. Check ' + response.pendingEmail + ' for a link to confirm your new email address.';
                        $scope.alertMessage.type = 'alert-warning';
                        $scope.alertMessage.show = true;
                        $timeout(function () { $scope.alertMessage.show = false; }, 8000);
                    } else {
                        $scope.alertMessage.text = 'User saved!';
                        $scope.alertMessage.type = 'alert-success';
                        $scope.alertMessage.show = true;
                        $timeout(function () { $scope.alertMessage.show = false; }, 3000);
                    }
                    $scope.loading = false;
                } else {
                    $scope.alertMessage.text = 'Error saving user: ' + response;
                    $scope.alertMessage.type = 'alert-danger';
                    $scope.alertMessage.show = true;
                    $timeout(function () { $scope.alertMessage.show = false; }, 3000);
                    $scope.loading = false;
                }
            }, function (response) {
                console.log(response);
                $scope.alertMessage.text = 'Error saving user: ' + response.data.error;
                $scope.alertMessage.type = 'alert-danger';
                $scope.alertMessage.show = true;
                $timeout(function () { $scope.alertMessage.show = false; }, 3000);
                $scope.loading = false;
            });
        };
        Api.Profile.get( function (results) {
            $scope.user = results;
            $scope.userLoading = false;
            $scope.existingUsername = false;
            $scope.existingEmail = false;
            $scope.loading = false;

            if (results.username) {
                $scope.user.originalUsername = results.username;
                $scope.user.originalEmail = results.email;
                $scope.user.lastlogondate = new Date(results.lastlogondate).toLocaleString('en-AU')
                console.log(results)
            }
        });
    }])

    // Server-side feature flags, handed over by the inline script in auth.ejs.
    // The partials below are served as static files, so EJS cannot reach them.
    .run(['$rootScope', function ($rootScope) {
        var config = window.pagermonConfig || {};
        $rootScope.passwordReset = config.passwordReset === true;
    }])

    .config(['$routeProvider', '$locationProvider', '$httpProvider', function ($routeProvider, $locationProvider, $httpProvider) {
        $routeProvider
            .when('/login', {
                templateUrl: '/templates/auth/login.html',
                controller: 'LoginController'
            })
            .when('/profile', {
                templateUrl: '/templates/auth/profile.html',
                controller: 'ProfileController'
            })
            .when('/register', {
                templateUrl: '/templates/auth/register.html',
                controller: 'RegisterController'
            })
            .when('/reset', {
                templateUrl: '/templates/auth/reset.html',
                controller: 'ResetController'
            })
            .when('/forgot', {
                templateUrl: '/templates/auth/forgot.html',
                controller: 'ForgotController'
            })
            .when('/reset-password/:token', {
                templateUrl: '/templates/auth/resetPassword.html',
                controller: 'ResetPasswordController'
            })
            .when('/verify-email/:token', {
                templateUrl: '/templates/auth/verifyEmail.html',
                controller: 'VerifyEmailController'
            });
        $httpProvider.defaults.headers.delete = { "Content-Type": "application/json;charset=utf-8" };
        $httpProvider.interceptors.push(function ($q, $location) {
            return {
                response: function (response) {
                    return response;
                },
                responseError: function (response) {
                    if (response.status === 401)
                        $location.absUrl('/login');
                    return $q.reject(response);
                }
            };
        });
        $locationProvider.html5Mode({ enabled: true, requireBase: false, rewriteLinks: true });
    }]);