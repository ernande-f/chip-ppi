import jwt from 'jsonwebtoken';
import 'dotenv/config';
import express from 'express';

export function authCookieMiddleware(req, res, next) {
    const user = req.user;
    if (!user) return next();

    const token = jwt.sign(
        { id : user.id_usuario, email: user.email},
        process.env.ACCESS_TOKEN,
        { expiresIn: '2d' }
    );

    res.cookie('authcookie', token,{
        maxAge: 2 * 24 * 60 * 60 * 1000,
        httpOnly:true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Strict'
    })
    
    next();

}