import React, { useState, useEffect, useCallback } from 'react';
import {
    Box,
    Button,
    Typography,
    Avatar,
    Stack,
    Menu,
    MenuItem,
    MenuButton,
    Dropdown,
    Divider,
    IconButton,
    Chip,
} from '@mui/joy';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext';
import { revokeAuth, listAppleAccounts, switchAppleAccount, removeAppleAccount } from '../utils/api';

import Swal from 'sweetalert2';
import LogoutIcon from '@mui/icons-material/Logout';
import PublicIcon from '@mui/icons-material/Public';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { useTranslation } from 'react-i18next';
import RegionSelector from './RegionSelector';

export default function UserStatus() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const {
        user,
        isAuthenticated,
        loading,
        logout,
        setUser,
        reconnectDownloadWebSocket,
    } = useApp();
    const [regionDialogOpen, setRegionDialogOpen] = useState(false);
    const [accounts, setAccounts] = useState([]);
    const [accountsLoading, setAccountsLoading] = useState(false);

    const refreshAccounts = useCallback(async () => {
        setAccountsLoading(true);
        try {
            const r = await listAppleAccounts();
            if (r.success && r.data?.accounts) {
                setAccounts(r.data.accounts);
            } else {
                setAccounts([]);
            }
        } catch {
            setAccounts([]);
        } finally {
            setAccountsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isAuthenticated && user) {
            refreshAccounts();
        }
    }, [isAuthenticated, user?.accountId, refreshAccounts]);

    const handleLogout = async () => {
        try {
            const result = await Swal.fire({
                title: t('ui.confirmRevokeLogin'),
                text: t('ui.confirmRevokeAppleId'),
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: t('ui.confirm'),
                cancelButtonText: t('ui.cancel'),
            });

            if (result.isConfirmed) {
                try {
                    await revokeAuth();
                    logout();
                    Swal.fire({
                        icon: 'success',
                        title: t('ui.logoutSuccess'),
                        timer: 1500,
                        showConfirmButton: false,
                    });
                } catch (error) {
                    Swal.fire({
                        icon: 'error',
                        title: t('ui.logoutFailed'),
                        text: error.message,
                        confirmButtonText: t('ui.confirm'),
                    });
                    logout();
                }
            }
        } catch (error) {
            console.error('退出登录错误:', error);
        }
    };

    const handleLogin = () => {
        navigate('/apple-id');
    };

    const handleRegionSelect = () => {
        setRegionDialogOpen(true);
    };

    const handleRegionDialogClose = (updatedUserData) => {
        setRegionDialogOpen(false);
        if (updatedUserData) {
            setUser(updatedUserData);
        }
    };

    const handleSwitchAccount = async (accountId) => {
        if (!accountId || accountId === user?.accountId) return;
        try {
            const r = await switchAppleAccount(accountId);
            if (r.success && r.data) {
                setUser(r.data);
                reconnectDownloadWebSocket();
                await refreshAccounts();
                Swal.fire({
                    icon: 'success',
                    title: t('ui.accountSwitched'),
                    timer: 1200,
                    toast: true,
                    position: 'top',
                    showConfirmButton: false,
                });
            }
        } catch (error) {
            Swal.fire({
                icon: 'error',
                title: t('ui.switchAccountFailed'),
                text: error.message,
                confirmButtonText: t('ui.confirm'),
            });
        }
    };

    const handleRemoveAccount = async (accountId, e) => {
        e?.stopPropagation?.();
        const result = await Swal.fire({
            title: t('ui.removeAppleAccountFromDevice'),
            text: t('ui.confirmRemoveAppleAccount'),
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: t('ui.confirm'),
            cancelButtonText: t('ui.cancel'),
            confirmButtonColor: '#d33',
        });
        if (!result.isConfirmed) return;

        try {
            const r = await removeAppleAccount(accountId);
            if (r.success) {
                if (r.data?.wasCurrent) {
                    logout();
                } else {
                    await refreshAccounts();
                }
                Swal.fire({
                    icon: 'success',
                    title: t('ui.accountRemoved'),
                    timer: 1500,
                    toast: true,
                    position: 'top',
                    showConfirmButton: false,
                });
            }
        } catch (error) {
            Swal.fire({
                icon: 'error',
                title: t('ui.accountRemoveFailed'),
                text: error.message,
                confirmButtonText: t('ui.confirm'),
            });
        }
    };

    if (loading) {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography level="body-sm">{t('ui.loading')}</Typography>
            </Box>
        );
    }

    if (!isAuthenticated || !user) {
        return (
            <Button variant="outlined" size="sm" onClick={handleLogin}>
                {t('ui.appleIdLogin')}
            </Button>
        );
    }

    return (
        <Dropdown>
            <MenuButton
                variant="plain"
                size="sm"
                sx={{
                    p: 0,
                    borderRadius: '50%',
                    overflow: 'hidden',
                }}
            >
                <Avatar size="sm" sx={{ bgcolor: 'primary.500', color: 'white' }}>
                    {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
                </Avatar>
            </MenuButton>

            <Menu placement="bottom-end" sx={{ minWidth: 280, maxWidth: 360 }}>
                <MenuItem disabled>
                    <Typography level="body-xs" sx={{ color: 'text.tertiary', width: '100%' }}>
                        {t('ui.currentAppleIdLoggedIn')}
                    </Typography>
                </MenuItem>
                <MenuItem disabled>
                    <Stack spacing={0.3}>
                        <Typography level="body-sm" fontWeight="md">
                            {user.name || t('ui.unknownUser')}
                        </Typography>
                        <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                            {user.email || t('ui.unknownEmail')}
                        </Typography>
                    </Stack>
                </MenuItem>

                <Divider />

                <MenuItem onClick={() => navigate('/apple-id?add=1')}>
                    <AddIcon />
                    {t('ui.addAnotherAppleId')}
                </MenuItem>

                <Divider />

                <MenuItem disabled sx={{ opacity: 1 }}>
                    <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                        {t('ui.savedAppleAccounts')}
                        {accountsLoading ? ' …' : ''}
                    </Typography>
                </MenuItem>

                {accounts.map((acc) => (
                    <MenuItem
                        key={acc.accountId}
                        variant={acc.current ? 'soft' : 'plain'}
                        onClick={() => {
                            if (!acc.current) handleSwitchAccount(acc.accountId);
                        }}
                        sx={{ alignItems: 'flex-start', py: 1 }}
                    >
                        <Stack direction="row" spacing={1} sx={{ width: '100%', alignItems: 'flex-start' }}>
                            <Stack sx={{ flex: 1, minWidth: 0 }}>
                                <Typography level="body-sm" noWrap title={acc.email}>
                                    {acc.email}
                                </Typography>
                                <Stack direction="row" spacing={0.5} sx={{ mt: 0.25, flexWrap: 'wrap' }}>
                                    {acc.current && (
                                        <Chip size="sm" variant="soft" color="primary">
                                            {t('ui.currentAccountBadge')}
                                        </Chip>
                                    )}
                                    {!acc.current && (
                                        <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                                            <SwapHorizIcon sx={{ fontSize: 14, verticalAlign: 'middle', mr: 0.25 }} />
                                            {t('ui.switchAccountAction')}
                                        </Typography>
                                    )}
                                </Stack>
                            </Stack>
                            <IconButton
                                size="sm"
                                variant="plain"
                                color="danger"
                                onClick={(e) => handleRemoveAccount(acc.accountId, e)}
                                aria-label={t('ui.removeAppleAccountFromDevice')}
                            >
                                <DeleteOutlineIcon />
                            </IconButton>
                        </Stack>
                    </MenuItem>
                ))}

                <Divider />

                <MenuItem onClick={handleRegionSelect}>
                    <PublicIcon />
                    <Stack direction="column" spacing={0.3}>
                        <Typography level="body-sm">
                            {t('ui.specifyRegion')}
                        </Typography>
                        {user.region && (
                            <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                                {t('ui.currentRegion', { region: user.region.toUpperCase() })}
                            </Typography>
                        )}
                    </Stack>
                </MenuItem>

                <Divider />

                <MenuItem onClick={handleLogout} color="danger">
                    <LogoutIcon />
                    {t('ui.revokeLogin')}
                </MenuItem>
            </Menu>

            <RegionSelector
                open={regionDialogOpen}
                onClose={handleRegionDialogClose}
                currentRegion={user?.region}
            />
        </Dropdown>
    );
}
